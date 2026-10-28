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

    private const CURSOR_PREFIX = 'DECLARE dbzuper_cursor NO SCROLL CURSOR FOR ';

    public function name(): DriverName
    {
        return DriverName::Postgres;
    }

    /** libpq would otherwise pick the database named after the user, which often doesn't exist. */
    public function maintenanceDatabases(): array
    {
        return ['postgres', 'template1'];
    }

    /** Databases that refuse connections (template0) can't be browsed, so they aren't listed. */
    public function listDatabaseNames(Connection $db): array
    {
        return array_map(fn ($row) => (string) $row->datname, $db->select('SELECT datname FROM pg_database WHERE datallowconn ORDER BY datname'));
    }

    /** Sizes only: counting tables would take a connection per database. */
    public function databaseStats(Connection $db): array
    {
        $rows = $db->select("SELECT datname, pg_database_size(datname) AS bytes FROM pg_database
            WHERE datallowconn AND has_database_privilege(datname, 'CONNECT')");
        $stats = [];
        foreach ($rows as $row) {
            $stats[(string) $row->datname] = ['tables' => null, 'bytes' => (int) $row->bytes];
        }

        return $stats;
    }

    public function systemDatabases(): array
    {
        return ['template0', 'template1'];
    }

    public function config(SavedConnection $connection, bool $countMatchedRows = false): array
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
            'options' => [PDO::ATTR_TIMEOUT => (int) config('dbzuper.connect_timeout')],
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

    /**
     * Native prepares treat "?" and ":name" as placeholders. Outside strings, quoted identifiers, comments and
     * dollar quotes, "?" becomes "??" (PDO pgsql escape) and a ":" starting a name (array slice) gets a space.
     */
    protected function prepareSql(string $sql): string
    {
        if (! str_contains($sql, '?') && ! str_contains($sql, ':')) {
            return $sql;
        }
        $tokens = SqlLexer::tokenize($sql, 'pgsql');
        $out = '';
        $last = 0;
        foreach ($tokens as $k => $token) {
            if ($token->type !== 'punct') {
                continue;
            }
            $replacement = null;
            if ($token->value === '?') {
                $replacement = '??';
            } elseif ($token->value === ':' && ($sql[$token->start - 1] ?? '') !== ':' && ($sql[$token->end] ?? '') !== ':'
                && isset($tokens[$k + 1]) && $tokens[$k + 1]->type === 'word' && $tokens[$k + 1]->start === $token->end) {
                $replacement = ': ';
            }
            if ($replacement !== null) {
                $out .= substr($sql, $last, $token->start - $last).$replacement;
                $last = $token->end;
            }
        }

        return $out.substr($sql, $last);
    }

    public function enforceReadOnly(Connection $db): void
    {
        $db->getPdo()->prepare('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')->execute();
    }

    public function explainPrefix(): string
    {
        return 'EXPLAIN ';
    }

    public function execute(Connection $db, string $sql, Classification $classification, int $maxRows, int $maxBytes): StatementResult
    {
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
                $pdo->prepare(self::CURSOR_PREFIX.$this->prepareSql($sql))->execute();
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
                $fetch = $pdo->prepare('FETCH FORWARD '.max(1, $size).' FROM dbzuper_cursor');
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
            $pdo->prepare('CLOSE dbzuper_cursor')->execute();
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

    public function serverInfo(Connection $db, SavedConnection $connection): array
    {
        $row = $db->selectOne("SELECT current_setting('server_version') AS version, current_user AS user,
            pg_encoding_to_char(d.encoding) AS charset, d.datcollate AS collation, current_setting('TimeZone') AS timezone,
            pg_database_size(current_database()) AS size_bytes,
            (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl
            FROM pg_database d WHERE d.datname = current_database()");

        return [
            'version' => (string) $row->version,
            'user' => (string) $row->user,
            'ssl' => $row->ssl === null ? null : (bool) $row->ssl,
            'charset' => $row->charset,
            'collation' => $row->collation,
            'timezone' => $row->timezone,
            'size_bytes' => (int) $row->size_bytes,
        ];
    }

    /** The release, e.g. "18.4 (Debian 18.4-1.pgdg12+1)"; version() would add the platform and compiler. */
    public function versionQuery(): string
    {
        return "select current_setting('server_version') as version";
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

    public function likeColumn(string $quotedColumn): string
    {
        return 'CAST('.$quotedColumn.' AS TEXT)';
    }

    public function likeOperator(): string
    {
        return 'ILIKE'; // LIKE is case-sensitive on PostgreSQL
    }

    public function sampleColumn(Connection $db, string $column, string $typeName, int $maxChars = CellValue::MAX_CHARS): Expression|string
    {
        $q = $this->quoteIdentifier($column);
        $sql = match (ColumnKind::classify($typeName)) {
            ColumnKind::Text => "left({$q}::text, ".($maxChars + 1).')',
            ColumnKind::Binary => "CASE WHEN {$q} IS NULL THEN NULL ELSE '[binary ' || octet_length({$q}) || ' bytes]' END",
            default => $q,
        };

        return $db->raw("{$sql} AS {$q}");
    }
}
