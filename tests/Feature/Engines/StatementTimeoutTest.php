<?php

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

afterEach(fn () => Engines::resetSqlite());

it('sets a per-session statement timeout', function (string $engine, string $sql, string $expected) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);

    $value = app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($saved, $sql) {
        app(DriverRegistry::class)->for($saved->driver)->applyStatementTimeout($db, 7);

        return (string) array_values((array) $db->selectOne($sql))[0];
    });

    expect($value)->toBe($expected);
})->with([
    'mysql' => ['mysql', 'select @@session.max_execution_time', '7000'],
    'mariadb' => ['mariadb', 'select @@session.max_statement_time', '7'],
    'pgsql' => ['pgsql', 'show statement_timeout', '7s'],
]);

it('is a no-op on SQLite', function () {
    $saved = Engines::savedConnection('sqlite');

    $ok = app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($saved) {
        app(DriverRegistry::class)->for($saved->driver)->applyStatementTimeout($db, 7);

        return (int) $db->selectOne('select 1 as one')->one;
    });

    expect($ok)->toBe(1);
});

it('still applies on read-only connections', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine, ['read_only' => true]);

    app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($saved) {
        app(DriverRegistry::class)->for($saved->driver)->applyStatementTimeout($db, 7);
        expect((int) $db->selectOne('select 1 as one')->one)->toBe(1);
    });
})->with(['mysql', 'mariadb', 'pgsql']);
