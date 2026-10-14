<?php

namespace App\Database\Drivers;

use App\Database\Contracts\Driver;
use App\Database\Contracts\SchemaInspector;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use LogicException;
use PDO;
use Pdo\Mysql;

class MySqlDriver implements Driver
{
    public function name(): DriverName
    {
        return DriverName::MySql;
    }

    public function config(SavedConnection $connection): array
    {
        $options = $connection->options ?? [];
        DsnValue::assertSafe(['host' => $connection->host, 'database' => $connection->database, 'username' => $connection->username, 'ssl_ca' => $options['ssl_ca'] ?? null]);

        $pdo = [PDO::ATTR_TIMEOUT => (int) config('dbsuperb.connect_timeout')];

        if (! empty($options['ssl_ca'])) {
            $pdo[Mysql::ATTR_SSL_CA] = $options['ssl_ca'];
            $pdo[Mysql::ATTR_SSL_VERIFY_SERVER_CERT] = (bool) ($options['ssl_verify'] ?? true);
        }

        if ($connection->read_only) {
            // Runs on every (re)connect, so the guard survives reconnects.
            $pdo[Mysql::ATTR_INIT_COMMAND] = 'SET SESSION TRANSACTION READ ONLY';
        }

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

    public function inspector(): SchemaInspector
    {
        throw new LogicException('Implemented in Task 10');
    }

    public function versionQuery(): string
    {
        return 'select version() as version';
    }
}
