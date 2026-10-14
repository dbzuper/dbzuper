<?php

use App\Database\ConnectionFactory;
use App\Database\Exceptions\SqlitePathNotAllowed;
use Illuminate\Database\QueryException;
use Tests\Support\Engines;

afterEach(fn () => Engines::resetSqlite());

it('opens a working connection', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $factory = app(ConnectionFactory::class);

    $db = $factory->make(Engines::savedConnection($engine));

    expect((int) $db->selectOne('select 1 as one')->one)->toBe(1);
    $factory->release($db);
})->with(Engines::ENGINES);

it('rejects writes at the database level on read-only connections', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $pdo = Engines::pdo($engine);
    $pdo->exec('drop table if exists ro_probe');
    $pdo->exec('create table ro_probe (id int primary key)');

    $db = app(ConnectionFactory::class)->make(Engines::savedConnection($engine, ['read_only' => true]));

    expect(fn () => $db->insert('insert into ro_probe (id) values (1)'))->toThrow(QueryException::class)
        ->and((int) $db->selectOne('select count(*) as c from ro_probe')->c)->toBe(0);

    app(ConnectionFactory::class)->release($db);
    $pdo->exec('drop table ro_probe');
})->with(Engines::ENGINES);

it('refuses SQLite files outside the allowlist', function () {
    $outside = tempnam(sys_get_temp_dir(), 'dbs');

    expect(fn () => app(ConnectionFactory::class)->make(Engines::savedConnection('sqlite', ['database' => $outside])))
        ->toThrow(SqlitePathNotAllowed::class);
});
