<?php

use App\Database\ConnectionFactory;
use App\Database\Exceptions\SqlitePathNotAllowed;
use Illuminate\Database\QueryException;
use Tests\Support\Engines;

afterEach(function () {
    foreach (Engines::ENGINES as $engine) {
        try {
            Engines::pdo($engine)->exec('drop table if exists ro_probe');
        } catch (Throwable) {
            // engine unreachable or file gone
        }
    }
    Engines::resetSqlite();
});

function dbsuperbConfigKeys(): array
{
    return array_values(array_filter(array_keys(config('database.connections')), fn ($k) => str_starts_with($k, 'dbsuperb_')));
}

function probeTable(string $engine): void
{
    $pdo = Engines::pdo($engine);
    $pdo->exec('drop table if exists ro_probe');
    $pdo->exec('create table ro_probe (id int primary key)');
}

function assertReadOnlyFailure(QueryException $e, string $engine): void
{
    if ($engine === 'sqlite') {
        expect(strtolower($e->getMessage()))->toContain('readonly');

        return;
    }

    $code = $e->getPrevious()->errorInfo;
    $ok = $engine === 'pgsql'
        ? $code[0] === '25006'
        : ((int) $code[1] === 1792 || $code[0] === '25006');
    expect($ok)->toBeTrue('not a read-only error: '.$e->getMessage());
}

it('opens a working connection', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $factory = app(ConnectionFactory::class);

    $db = $factory->make(Engines::savedConnection($engine));

    expect((int) $db->selectOne('select 1 as one')->one)->toBe(1);
    $factory->release($db);
})->with(Engines::ENGINES);

it('rejects writes at the database level on read-only connections', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    probeTable($engine);

    app(ConnectionFactory::class)->using(Engines::savedConnection($engine, ['read_only' => true]), function ($db) use ($engine) {
        try {
            $db->insert('insert into ro_probe (id) values (1)');
            $this->fail('write was not rejected');
        } catch (QueryException $e) {
            assertReadOnlyFailure($e, $engine);
        }

        expect((int) $db->selectOne('select count(*) as c from ro_probe')->c)->toBe(0);
    });
})->with(Engines::ENGINES);

it('allows the same write on a non-read-only connection (control)', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    probeTable($engine);

    app(ConnectionFactory::class)->using(Engines::savedConnection($engine), function ($db) {
        $db->insert('insert into ro_probe (id) values (1)');
        expect((int) $db->selectOne('select count(*) as c from ro_probe')->c)->toBe(1);
    });
})->with(Engines::ENGINES);

it('keeps rejecting writes after a reconnect', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    probeTable($engine);

    app(ConnectionFactory::class)->using(Engines::savedConnection($engine, ['read_only' => true]), function ($db) use ($engine) {
        $db->reconnect();

        try {
            $db->insert('insert into ro_probe (id) values (1)');
            $this->fail('write was not rejected after reconnect');
        } catch (QueryException $e) {
            assertReadOnlyFailure($e, $engine);
        }
    });
})->with(Engines::ENGINES);

it('refuses SQLite files outside the allowlist', function () {
    $outside = tempnam(sys_get_temp_dir(), 'dbs');

    expect(fn () => app(ConnectionFactory::class)->make(Engines::savedConnection('sqlite', ['database' => $outside])))
        ->toThrow(SqlitePathNotAllowed::class);
});

it('removes the config entry after using() returns and after the callback throws', function () {
    $factory = app(ConnectionFactory::class);

    $factory->using(Engines::savedConnection('sqlite'), fn ($db) => $db->selectOne('select 1'));
    expect(dbsuperbConfigKeys())->toBe([]);

    expect(fn () => $factory->using(Engines::savedConnection('sqlite'), function ($db) {
        expect(dbsuperbConfigKeys())->toHaveCount(1);
        throw new RuntimeException('boom');
    }))->toThrow(RuntimeException::class);
    expect(dbsuperbConfigKeys())->toBe([]);
});

it('removes the config entry when the connection to an unreachable server fails', function () {
    $saved = Engines::savedConnection('mysql', ['host' => '127.0.0.1', 'port' => 1]);

    expect(fn () => app(ConnectionFactory::class)->using($saved, fn ($db) => $db->selectOne('select 1')))
        ->toThrow(QueryException::class);
    expect(dbsuperbConfigKeys())->toBe([]);
});
