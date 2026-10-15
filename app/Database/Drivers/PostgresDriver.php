<?php

namespace App\Database\Drivers;

use App\Database\CellValue;
use App\Database\ColumnKind;
use App\Database\Contracts\Driver;
use App\Database\Contracts\SchemaInspector;
use App\Database\Drivers\Concerns\AppliesTimeoutBestEffort;
use App\Database\Exceptions\InvalidConnectionOption;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use Illuminate\Contracts\Database\Query\Expression;
use Illuminate\Database\Connection;
use PDO;

class PostgresDriver implements Driver
{
    use AppliesTimeoutBestEffort;

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
