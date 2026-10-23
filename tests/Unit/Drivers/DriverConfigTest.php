<?php

use App\Database\DriverRegistry;
use App\Database\Exceptions\InvalidConnectionOption;
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
        ->and($config['options'][Mysql::ATTR_MULTI_STATEMENTS])->toBeFalse()
        ->and($config['options'][Mysql::ATTR_INIT_COMMAND])->toContain('sql_mode')->not->toContain('READ ONLY')->not->toContain('read_only');
});

it('adds a read-only init command for MySQL and MariaDB', function (DriverName $driver) {
    $config = app(DriverRegistry::class)->for($driver)->config(saved(['driver' => $driver, 'read_only' => true]));

    expect($config['driver'])->toBe($driver->value)
        ->and($config['options'][Mysql::ATTR_INIT_COMMAND])->toContain('sql_mode')->toEndWith('SESSION '.($driver === DriverName::MariaDb ? 'tx_read_only' : 'transaction_read_only').' = 1');
})->with([DriverName::MySql, DriverName::MariaDb]);

it('builds a PostgreSQL config with schema, sslmode and read-only session', function () {
    $config = app(DriverRegistry::class)->for(DriverName::Postgres)
        ->config(saved(['driver' => DriverName::Postgres, 'read_only' => true, 'options' => ['schema' => 'sales', 'sslmode' => 'require']]));

    expect($config)->toMatchArray([
        'driver' => 'pgsql', 'port' => 5432, 'search_path' => 'sales', 'sslmode' => 'require',
        'isolation_level' => 'read committed, read only',
    ])->and($config['server_options'])->toBe(['standard_conforming_strings' => 'on']);
});

it('defaults PostgreSQL to the public schema and sslmode prefer without read-only', function () {
    $config = app(DriverRegistry::class)->for(DriverName::Postgres)->config(saved(['driver' => DriverName::Postgres]));

    expect($config)->toMatchArray(['search_path' => 'public', 'sslmode' => 'prefer'])
        ->and($config)->not->toHaveKey('isolation_level');
});

it('rejects a malicious PostgreSQL sslmode', function () {
    app(DriverRegistry::class)->for(DriverName::Postgres)
        ->config(saved(['driver' => DriverName::Postgres, 'options' => ['sslmode' => 'prefer;host=evil']]));
})->throws(InvalidArgumentException::class);

it('rejects a malicious PostgreSQL schema', function () {
    app(DriverRegistry::class)->for(DriverName::Postgres)
        ->config(saved(['driver' => DriverName::Postgres, 'options' => ['schema' => 'public; drop table x']]));
})->throws(InvalidArgumentException::class);

it('rejects hosts containing DSN separators', function (DriverName $driver, string $host) {
    app(DriverRegistry::class)->for($driver)->config(saved(['driver' => $driver, 'host' => $host]));
})->with([
    [DriverName::Postgres, 'db;host=evil'],
    [DriverName::MySql, "db\nevil"],
    [DriverName::MariaDb, "db\0evil"],
])->throws(InvalidArgumentException::class);

it('rejects an ssl_ca containing a semicolon', function () {
    app(DriverRegistry::class)->for(DriverName::Postgres)
        ->config(saved(['driver' => DriverName::Postgres, 'options' => ['ssl_ca' => '/a;sslmode=disable']]));
})->throws(InvalidArgumentException::class);

it('rejects libpq keyword injection in PostgreSQL DSN values', function (array $attributes) {
    app(DriverRegistry::class)->for(DriverName::Postgres)->config(saved(['driver' => DriverName::Postgres, ...$attributes]));
})->with([
    'database with quote and space' => [['database' => "shop' hostaddr='203.0.113.9"]],
    'database with space' => [['database' => 'shop hostaddr=203.0.113.9']],
    'database with backslash' => [['database' => 'shop\\']],
    'ssl_ca with space' => [['options' => ['ssl_ca' => '/tmp/ca.pem hostaddr=203.0.113.10']]],
    'ssl_ca with quote' => [['options' => ['ssl_ca' => "/tmp/ca.pem'"]]],
    'host with space' => [['host' => 'db.internal hostaddr=203.0.113.9']],
    'username with tab' => [['username' => "app\thostaddr=203.0.113.9"]],
])->throws(InvalidConnectionOption::class);

it('still allows spaces and quotes in MySQL database names, which the MySQL DSN treats literally', function () {
    $config = app(DriverRegistry::class)->for(DriverName::MySql)->config(saved(['driver' => DriverName::MySql, 'database' => "my shop's=db"]));

    expect($config['database'])->toBe("my shop's=db");
});

it('sets the MySQL TLS options for each SSL mode', function (DriverName $driver, array $options, array $expected) {
    $pdo = app(DriverRegistry::class)->for($driver)->config(saved(['driver' => $driver, 'options' => $options]))['options'];

    $tls = array_intersect_key($pdo, array_flip([Mysql::ATTR_SSL_CA, Mysql::ATTR_SSL_VERIFY_SERVER_CERT, Mysql::ATTR_SSL_CIPHER, Mysql::ATTR_SSL_CAPATH]));
    ksort($tls);
    ksort($expected);

    expect($tls)->toBe($expected);
})->with([DriverName::MySql, DriverName::MariaDb])->with([
    'disabled' => [['mysql_ssl' => 'disabled', 'ssl_ca' => '/ca.pem'], []],
    // An empty CA is what switches mysqlnd to TLS; with verification off the CA is never loaded.
    'required' => [['mysql_ssl' => 'required'], [Mysql::ATTR_SSL_CA => '', Mysql::ATTR_SSL_VERIFY_SERVER_CERT => false]],
    'required ignores a CA path' => [['mysql_ssl' => 'required', 'ssl_ca' => '/ca.pem'], [Mysql::ATTR_SSL_CA => '', Mysql::ATTR_SSL_VERIFY_SERVER_CERT => false]],
    'verify identity' => [['mysql_ssl' => 'verify_identity', 'ssl_ca' => '/ca.pem'], [Mysql::ATTR_SSL_CA => '/ca.pem', Mysql::ATTR_SSL_VERIFY_SERVER_CERT => true]],
    'verify identity ignores a legacy ssl_verify' => [['mysql_ssl' => 'verify_identity', 'ssl_ca' => '/ca.pem', 'ssl_verify' => false], [Mysql::ATTR_SSL_CA => '/ca.pem', Mysql::ATTR_SSL_VERIFY_SERVER_CERT => true]],
    'legacy: no mode, no CA' => [[], []],
    'legacy: no mode, empty CA' => [['ssl_ca' => ''], []],
    'legacy: no mode, CA' => [['ssl_ca' => '/ca.pem'], [Mysql::ATTR_SSL_CA => '/ca.pem', Mysql::ATTR_SSL_VERIFY_SERVER_CERT => true]],
    'legacy: no mode, CA, ssl_verify true' => [['ssl_ca' => '/ca.pem', 'ssl_verify' => true], [Mysql::ATTR_SSL_CA => '/ca.pem', Mysql::ATTR_SSL_VERIFY_SERVER_CERT => true]],
    'legacy: no mode, CA, ssl_verify false' => [['ssl_ca' => '/ca.pem', 'ssl_verify' => false], [Mysql::ATTR_SSL_CA => '', Mysql::ATTR_SSL_VERIFY_SERVER_CERT => false]],
]);

it('refuses to connect without TLS when an SSL mode is unusable', function (array $options) {
    app(DriverRegistry::class)->for(DriverName::MySql)->config(saved(['driver' => DriverName::MySql, 'options' => $options]));
})->with([
    'verify identity without a CA' => [['mysql_ssl' => 'verify_identity']],
    'unknown mode' => [['mysql_ssl' => 'preferred']],
])->throws(InvalidConnectionOption::class);

it('rejects an unsafe CA path in verify identity mode', function () {
    app(DriverRegistry::class)->for(DriverName::MySql)
        ->config(saved(['driver' => DriverName::MySql, 'options' => ['mysql_ssl' => 'verify_identity', 'ssl_ca' => "/ca.pem\n;host=evil"]]));
})->throws(InvalidConnectionOption::class);

it('leaves the PostgreSQL TLS options untouched by the MySQL SSL mode', function () {
    $config = app(DriverRegistry::class)->for(DriverName::Postgres)
        ->config(saved(['driver' => DriverName::Postgres, 'options' => ['mysql_ssl' => 'required', 'sslmode' => 'verify-full', 'ssl_ca' => '/ca.pem']]));

    expect($config)->toMatchArray(['sslmode' => 'verify-full', 'sslrootcert' => '/ca.pem']);
});
