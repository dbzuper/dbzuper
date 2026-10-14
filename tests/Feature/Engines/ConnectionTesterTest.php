<?php

use App\Database\ConnectionTester;
use Tests\Support\Engines;

afterEach(fn () => Engines::resetSqlite());

it('reports success with a server version', function (string $engine) {
    Engines::skipUnlessAvailable($engine);

    $result = app(ConnectionTester::class)->test(Engines::savedConnection($engine));

    expect($result['ok'])->toBeTrue()
        ->and($result['version'])->toBeString()->not->toBeEmpty()
        ->and($result['latency_ms'])->toBeInt()
        ->and($result['error'])->toBeNull();
})->with(Engines::ENGINES);

it('diagnoses a wrong password', function (string $engine) {
    Engines::skipUnlessAvailable($engine);

    $result = app(ConnectionTester::class)->test(Engines::savedConnection($engine, ['password' => 'definitely-wrong']));

    expect($result['ok'])->toBeFalse()
        ->and($result['error']['kind'])->toBe('auth')
        ->and(json_encode($result))->not->toContain('definitely-wrong')
        ->and(json_encode($result))->not->toContain('dbsuperb_');
})->with(['mysql', 'mariadb', 'pgsql']);

it('diagnoses an unknown database', function (string $engine) {
    Engines::skipUnlessAvailable($engine);

    $result = app(ConnectionTester::class)->test(Engines::savedConnection($engine, ['database' => 'dbsuperb_nope']));

    expect($result['error']['reason'])->toBe('unknown_database');
})->with(['mysql', 'mariadb', 'pgsql']);

it('diagnoses a refused port quickly', function (string $engine) {
    $result = app(ConnectionTester::class)->test(Engines::savedConnection($engine, ['host' => '127.0.0.1', 'port' => 1]));

    expect($result['ok'])->toBeFalse()
        ->and($result['error']['kind'])->toBe('connection')
        ->and($result['error']['reason'])->toBe('refused')
        ->and(json_encode($result))->not->toContain('dbsuperb_');
})->with(['mysql', 'pgsql']);

it('rejects unsafe option values with an invalid_option reason', function () {
    $result = app(ConnectionTester::class)->test(
        Engines::savedConnection('pgsql', ['options' => ['sslmode' => 'prefer;host=evil']]),
    );

    expect($result['ok'])->toBeFalse()
        ->and($result['error']['reason'])->toBe('invalid_option');
});

it('gives up on an unroutable host within the connect timeout', function () {
    config(['dbsuperb.connect_timeout' => 2]);
    $started = microtime(true);

    $result = app(ConnectionTester::class)->test(Engines::savedConnection('mysql', ['host' => '10.255.255.1', 'port' => 3306]));

    expect($result['ok'])->toBeFalse()
        ->and(microtime(true) - $started)->toBeLessThan(6.0);
})->group('slow');

it('diagnoses a missing SQLite file', function () {
    $result = app(ConnectionTester::class)->test(
        Engines::savedConnection('sqlite', ['database' => Engines::sqliteDirectory().'/missing.sqlite']),
    );

    expect($result['error']['reason'])->toBe('sqlite_missing');
});
