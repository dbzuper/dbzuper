<?php

namespace App\Database\Drivers;

use App\Database\CellValue;
use App\Database\ColumnKind;
use App\Database\Contracts\Driver;
use App\Database\Contracts\SchemaInspector;
use App\Database\Drivers\Concerns\AppliesTimeoutBestEffort;
use App\Database\Exceptions\InvalidConnectionOption;
use App\Database\Exceptions\OffsetQueryException;
use App\Database\Query\StatementResult;
use App\Database\Sql\Classification;
use App\Database\Sql\SqlLexer;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use Illuminate\Contracts\Database\Query\Expression;
use Illuminate\Database\Connection;
use PDO;
use PDOException;
use Throwable;

class PostgresDriver implements Driver
{
    use AppliesTimeoutBestEffort;
    use ExecutesStatements {
        execute as executePlain;
    }

    private const FETCH_PAGE = 200;

    private const CURSOR_PREFIX = 'DECLARE dbsuperb_cursor NO SCROLL CURSOR FOR ';

    public function name(): DriverName
    {
        return DriverName::Postgres;
    }

    public function config(SavedConnection $connection): array
    {
        $options = $connection->options ?? [];

        $sslmode = $options['sslmode'] ?? 'prefer';
        if (! in_array($sslmode, ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'], true)) {
            throw new InvalidConnectionOption('Invalid sslmode.');
        }

        $schema = $options['schema'] ?? 'public';
        if (! is_string($schema) || ! preg_match('/^[A-Za-z_][A-Za-z0-9_$]*$/', $schema)) {
            throw new InvalidConnectionOption('Invalid schema name.');
        }

        DsnValue::assertSafeForLibpq(['host' => $connection->host, 'database' => $connection->database, 'username' => $connection->username, 'ssl_ca' => $options['ssl_ca'] ?? null]);

        $config = [
            'driver' => 'pgsql',
            'host' => $connection->host,
            'port' => $connection->port ?? 5432,
            'database' => $connection->database,
            'username' => $connection->username,
            'password' => $connection->password ?? '',
            'charset' => 'utf8',
            'prefix' => '',
            'search_path' => $schema,
            'sslmode' => $sslmode,
            'options' => [PDO::ATTR_TIMEOUT => (int) config('dbsuperb.connect_timeout')],
            // Sent in the startup packet, so it holds on every (re)connect: backslashes in '...' stay literal,
            // matching SqlLexer.
            'server_options' => ['standard_conforming_strings' => 'on'],
        ];

        if (! empty($options['ssl_ca'])) {
            $config['sslrootcert'] = $options['ssl_ca'];
        }

        if ($connection->read_only) {
            // Laravel runs "set session characteristics as transaction isolation level <value>" on every connect;
            // appending "read only" makes every transaction in the session read-only.
            $config['isolation_level'] = 'read committed, read only';
        }

        return $config;
    }

    /** Doubles every "?" outside strings, quoted identifiers, comments and dollar quotes (PDO pgsql escape). */
    private function escapeQuestionMarks(string $sql): string
    {
        if (! str_contains($sql, '?')) {
            return $sql;
        }
        $out = '';
        $last = 0;
        foreach (SqlLexer::tokenize($sql, 'pgsql') as $token) {
            if ($token->type === 'punct' && $token->value === '?') {
                $out .= substr($sql, $last, $token->start - $last).'??';
                $last = $token->end;
            }
        }

        return $out.substr($sql, $last);
    }

    public function explainPrefix(): string
    {
        return 'EXPLAIN ';
    }

    public function execute(Connection $db, string $sql, Classification $classification, int $maxRows, int $maxBytes): StatementResult
    {
        // Native prepares rewrite "?" placeholders; jsonb operators need them literal.
        $sql = $this->escapeQuestionMarks($sql);

        // The classifier's keyword is comment-free, unlike the raw text.
        if ($classification->kind !== 'read' || ! in_array($classification->keyword, ['SELECT', 'WITH', 'VALUES', 'TABLE'], true)) {
            return $this->executePlain($db, $sql, $classification, $maxRows, $maxBytes);
        }

        // libpq buffers whole results client-side; a server-side cursor bounds memory to the fetched page.
        // prepare()/execute() uses the extended protocol, which accepts exactly one command, so a smuggled
        // second statement is a syntax error rather than being run.
        $started = hrtime(true);
        $pdo = $db->getPdo();
        $ownTransaction = ! $pdo->inTransaction();
        if ($ownTransaction) {
            $pdo->beginTransaction();
        }
        try {
            try {
                $pdo->prepare(self::CURSOR_PREFIX.$sql)->execute();
            } catch (PDOException $e) {
                throw new OffsetQueryException($e, strlen(self::CURSOR_PREFIX));
            }
            // Fetch in small pages so libpq never holds more than a page of uncapped rows at once.
            $columns = [];
            $rows = [];
            $bytes = 0;
            $truncated = false;
            while (true) {
                $size = min(self::FETCH_PAGE, $maxRows + 1 - count($rows));
                $fetch = $pdo->prepare('FETCH FORWARD '.max(1, $size).' FROM dbsuperb_cursor');
                $fetch->execute();
                if ($columns === []) {
                    $columns = $this->columnsOf($fetch);
                }
                $before = count($rows);
                $truncated = $this->appendRows($fetch, $rows, $bytes, $maxRows, $maxBytes);
                $fetch->closeCursor();
                if ($truncated || count($rows) === $before) {
                    break;
                }
            }
            $pdo->prepare('CLOSE dbsuperb_cursor')->execute();
            $result = new StatementResult($sql, $classification, $columns, $rows, $truncated, null, $this->elapsed($started), null, $bytes);

            if ($ownTransaction) {
                $pdo->commit();
            }

            return $result;
        } catch (Throwable $t) {
            if ($ownTransaction && $pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $t;
        }
    }

    public function inspector(): SchemaInspector
    {
        return app(PostgresInspector::class);
    }

    public function versionQuery(): string
    {
        return 'select version() as version';
    }

    public function applyStatementTimeout(Connection $db, int $seconds): void
    {
        $this->setTimeoutBestEffort($db, 'SET statement_timeout = '.max(1, $seconds) * 1000);
    }

    public function ddl(Connection $db, string $table, string $kind): ?string
    {
        return null; // PostgreSQL has no native SHOW CREATE; the UI generates an approximation.
    }

    public function quoteIdentifier(string $name): string
    {
        return '"'.str_replace('"', '""', $name).'"';
    }

    public function sampleColumn(Connection $db, string $column, string $typeName): Expression|string
    {
        $q = $this->quoteIdentifier($column);
        $sql = match (ColumnKind::classify($typeName)) {
            ColumnKind::Text => "left({$q}::text, ".(CellValue::MAX_CHARS + 1).')',
            ColumnKind::Binary => "CASE WHEN {$q} IS NULL THEN NULL ELSE '[binary ' || octet_length({$q}) || ' bytes]' END",
            default => $q,
        };

        return $db->raw("{$sql} AS {$q}");
    }
}
