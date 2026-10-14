<?php

use App\Database\DriverRegistry;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use Pdo\Mysql;
use Tests\TestCase;

uses(TestCase::class);

function saved(array $attributes): SavedConnection
{
    return new SavedConnection(array_merge([
        'name' => 'x', 'host' => 'db.internal', 'port' => null, 'database' => 'app',
        'username' => 'u', 'password' => 'p', 'options' => [], 'read_only' => false,
    ], $attributes));
}

it('builds a MySQL config with timeout, default port and optional TLS', function () {
    config(['dbsuperb.connect_timeout' => 4]);
    $config = app(DriverRegistry::class)->for(DriverName::MySql)
        ->config(saved(['driver' => DriverName::MySql, 'options' => ['ssl_ca' => '/ca.pem', 'ssl_verify' => true]]));

    expect($config)->toMatchArray(['driver' => 'mysql', 'host' => 'db.internal', 'port' => 3306, 'database' => 'app', 'charset' => 'utf8mb4'])
        ->and($config['options'][PDO::ATTR_TIMEOUT])->toBe(4)
        ->and($config['options'][Mysql::ATTR_SSL_CA])->toBe('/ca.pem')
        ->and($config['options'][Mysql::ATTR_SSL_VERIFY_SERVER_CERT])->toBeTrue()
        ->and($config['options'])->not->toHaveKey(Mysql::ATTR_INIT_COMMAND);
});

it('adds a read-only init command for MySQL and MariaDB', function (DriverName $driver) {
    $config = app(DriverRegistry::class)->for($driver)->config(saved(['driver' => $driver, 'read_only' => true]));

    expect($config['driver'])->toBe($driver->value)
        ->and($config['options'][Mysql::ATTR_INIT_COMMAND])->toBe('SET SESSION TRANSACTION READ ONLY');
})->with([DriverName::MySql, DriverName::MariaDb]);

it('builds a PostgreSQL config with schema, sslmode and read-only session', function () {
    $config = app(DriverRegistry::class)->for(DriverName::Postgres)
        ->config(saved(['driver' => DriverName::Postgres, 'read_only' => true, 'options' => ['schema' => 'sales', 'sslmode' => 'require']]));

    expect($config)->toMatchArray([
        'driver' => 'pgsql', 'port' => 5432, 'search_path' => 'sales', 'sslmode' => 'require',
        'isolation_level' => 'read committed, read only',
    ]);
});

it('defaults PostgreSQL to the public schema and sslmode prefer without read-only', function () {
    $config = app(DriverRegistry::class)->for(DriverName::Postgres)->config(saved(['driver' => DriverName::Postgres]));

    expect($config)->toMatchArray(['search_path' => 'public', 'sslmode' => 'prefer'])
        ->and($config)->not->toHaveKey('isolation_level');
});
