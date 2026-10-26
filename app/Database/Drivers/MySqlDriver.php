<?php

namespace App\Database\Drivers;

use App\Database\CellValue;
use App\Database\ColumnKind;
use App\Database\Contracts\Driver;
use App\Database\Contracts\SchemaInspector;
use App\Database\Drivers\Concerns\AppliesTimeoutBestEffort;
use App\Database\Sql\Classification;
use App\Enums\DriverName;
use App\Enums\MySqlSslMode;
use App\Models\SavedConnection;
use Illuminate\Contracts\Database\Query\Expression;
use Illuminate\Database\Connection;
use PDO;
use Pdo\Mysql;

class MySqlDriver implements Driver
{
    use AppliesTimeoutBestEffort;
    use ExecutesStatements;

    /**
     * Current sql_mode without NO_BACKSLASH_ESCAPES, ANSI_QUOTES and the composite modes that imply ANSI_QUOTES
     * (matched as whole comma-separated items, so ANSI does not hit ANSI_QUOTES).
     */
    public const STRIPPED_SQL_MODE = "TRIM(BOTH ',' FROM REGEXP_REPLACE(REGEXP_REPLACE(CONCAT(',', @@sql_mode, ','), ',(NO_BACKSLASH_ESCAPES|ANSI_QUOTES|ANSI|ORACLE|MSSQL|DB2|POSTGRESQL|MAXDB)(?=,)', ''), ',+', ','))";

    public function name(): DriverName
    {
        return DriverName::MySql;
    }

    public function maintenanceDatabases(): array
    {
        return [''];
    }

    public function listDatabaseNames(Connection $db): array
    {
        return array_map(fn ($row) => (string) array_values((array) $row)[0], $db->select('SHOW DATABASES'));
    }

    public function databaseStats(Connection $db): array
    {
        $rows = $db->select('SELECT table_schema AS name, COUNT(*) AS tables_count,
            SUM(COALESCE(data_length, 0) + COALESCE(index_length, 0)) AS bytes
            FROM information_schema.tables GROUP BY table_schema');
        $stats = [];
        foreach ($rows as $row) {
            $stats[(string) $row->name] = ['tables' => (int) $row->tables_count, 'bytes' => (int) $row->bytes];
        }

        return $stats;
    }

    public function systemDatabases(): array
    {
        return ['information_schema', 'performance_schema', 'mysql', 'sys'];
    }

    public function config(SavedConnection $connection, bool $countMatchedRows = false): array
    {
        $options = $connection->options ?? [];
        DsnValue::assertSafe(['host' => $connection->host, 'database' => $connection->database, 'username' => $connection->username, 'ssl_ca' => $options['ssl_ca'] ?? null]);

        $pdo = [
            PDO::ATTR_TIMEOUT => (int) config('dbsuperb.connect_timeout'),
            Mysql::ATTR_MULTI_STATEMENTS => false,
        ];
        if ($countMatchedRows) {
            // Connect-time only, so only the change-set connection asks for it: the SQL editor keeps MySQL's
            // usual "changed rows" count.
            $pdo[Mysql::ATTR_FOUND_ROWS] = true;
        }

        switch (MySqlSslMode::fromOptions($options)) {
            case MySqlSslMode::Required:
                // mysqlnd only starts TLS when an SSL attribute is set. An empty CA switches it on without
                // changing anything else; with verification off the CA is never loaded (checked on PHP 8.4,
                // Windows and Linux), so a saved CA path would be ignored anyway.
                $pdo[Mysql::ATTR_SSL_CA] = '';
                $pdo[Mysql::ATTR_SSL_VERIFY_SERVER_CERT] = false;
                break;
            case MySqlSslMode::VerifyIdentity:
                // Verifies the chain against the CA and the host name against the certificate.
                $pdo[Mysql::ATTR_SSL_CA] = $options['ssl_ca'];
                $pdo[Mysql::ATTR_SSL_VERIFY_SERVER_CERT] = true;
                break;
            case MySqlSslMode::Disabled:
                break;
        }

        // Runs on every (re)connect, so these survive reconnects. Strings must lex the way SqlLexer reads them:
        // backslash escapes on, double quotes as string delimiters (not identifiers).
        $init = 'SESSION sql_mode = '.self::STRIPPED_SQL_MODE;
        if ($connection->read_only) {
            $init .= ', SESSION '.$this->readOnlyVariable().' = 1';
        }
        $pdo[Mysql::ATTR_INIT_COMMAND] = 'SET '.$init;

        return [
            'driver' => $this->name()->value,
            'host' => $connection->host,
            'port' => $connection->port ?? 3306,
            'database' => $connection->database,
            'username' => $connection->username,
            'password' => $connection->password ?? '',
            'charset' => 'utf8mb4',
            'prefix' => '',
            'options' => $pdo,
        ];
    }

    /** Session variable for the read-only guard; SET can combine it with sql_mode, unlike SET TRANSACTION. */
    protected function readOnlyVariable(): string
    {
        return 'transaction_read_only';
    }

    public function enforceReadOnly(Connection $db): void
    {
        $db->getPdo()->prepare('SET SESSION '.$this->readOnlyVariable().' = 1')->execute();
    }

    public function explainPrefix(): string
    {
        return 'EXPLAIN ';
    }

    protected function beforeStatement(PDO $pdo, Classification $classification, int $maxRows): mixed
    {
        // closeCursor() on an unbuffered result reads every remaining row, so a capped read would still drain the
        // whole table. The server-side limit stops it after one row past the cap (an explicit LIMIT still wins).
        $capped = $classification->kind === 'read';
        if ($capped) {
            $pdo->exec('SET SESSION sql_select_limit = '.($maxRows + 1));
        }
        $state = [$pdo->getAttribute(Mysql::ATTR_USE_BUFFERED_QUERY), $pdo->getAttribute(PDO::ATTR_EMULATE_PREPARES), $capped];
        $pdo->setAttribute(Mysql::ATTR_USE_BUFFERED_QUERY, false); // stream rows instead of loading them all
        $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, true);      // any statement type, still one statement only

        return $state;
    }

    protected function afterStatement(PDO $pdo, mixed $state): void
    {
        $pdo->setAttribute(Mysql::ATTR_USE_BUFFERED_QUERY, $state[0]);
        $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, $state[1]);
        if ($state[2]) {
            $pdo->exec('SET SESSION sql_select_limit = DEFAULT');
        }
    }

    public function inspector(): SchemaInspector
    {
        return app(MySqlInspector::class);
    }

    public function versionQuery(): string
    {
        return 'select version() as version';
    }

    public function applyStatementTimeout(Connection $db, int $seconds): void
    {
        $this->setTimeoutBestEffort($db, 'SET SESSION max_execution_time = '.max(1, $seconds) * 1000);
    }

    public function ddl(Connection $db, string $table, string $kind): ?string
    {
        $isView = $kind === 'view';
        $row = (array) $db->selectOne(($isView ? 'SHOW CREATE VIEW ' : 'SHOW CREATE TABLE ').$this->quoteIdentifier($table));

        return $row[$isView ? 'Create View' : 'Create Table'] ?? null;
    }

    public function quoteIdentifier(string $name): string
    {
        return '`'.str_replace('`', '``', $name).'`';
    }

    public function likeColumn(string $quotedColumn): string
    {
        return $quotedColumn;
    }

    public function likeOperator(): string
    {
        return 'LIKE';
    }

    public function sampleColumn(Connection $db, string $column, string $typeName, int $maxChars = CellValue::MAX_CHARS): Expression|string
    {
        $q = $this->quoteIdentifier($column);
        $sql = match (ColumnKind::classify($typeName)) {
            ColumnKind::Text => "LEFT({$q}, ".($maxChars + 1).')',
            ColumnKind::Binary => "CASE WHEN {$q} IS NULL THEN NULL ELSE CONCAT('[binary ', LENGTH({$q}), ' bytes]') END",
            default => $q,
        };

        return $db->raw("{$sql} AS {$q}");
    }
}
