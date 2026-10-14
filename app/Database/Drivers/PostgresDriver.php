<?php

namespace App\Database\Drivers;

use App\Database\Contracts\Driver;
use App\Database\Contracts\SchemaInspector;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Database\Exceptions\InvalidConnectionOption;
use LogicException;
use PDO;

class PostgresDriver implements Driver
{
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

        DsnValue::assertSafe(['host' => $connection->host, 'database' => $connection->database, 'username' => $connection->username, 'ssl_ca' => $options['ssl_ca'] ?? null]);

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
        throw new LogicException('Implemented in Task 10');
    }

    public function versionQuery(): string
    {
        return 'select version() as version';
    }
}
