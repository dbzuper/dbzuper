<?php

use App\Database\DatabaseEntry;
use App\Database\DatabaseLister;
use App\Database\Drivers\MySqlDriver;
use App\Database\Schema\SnapshotService;
use App\Models\SavedConnection;
use App\Models\User;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

/** Extra databases each engine test creates; MySQL-family names include a dash to prove they open. */
function listerDatabases(string $engine): array
{
    return $engine === 'pgsql' ? ['dbzuper_test_two'] : ['dbzuper_test_two', 'dbzuper_test-three'];
}

function listerQuote(string $engine, string $name): string
{
    return $engine === 'pgsql' ? '"'.$name.'"' : '`'.$name.'`';
}

function listerSetUp(string $engine): SavedConnection
{
    Engines::skipUnlessAvailable($engine);
    listerTearDown($engine);
    $pdo = Engines::serverPdo($engine);
    foreach (listerDatabases($engine) as $name) {
        $pdo->exec('create database '.listerQuote($engine, $name));
        if ($engine === 'pgsql') {
            $p = Engines::params('pgsql');
            (new PDO("pgsql:host={$p['host']};port={$p['port']};dbname={$name}", $p['username'], $p['password']))->exec('create table listed (id int)');
        } else {
            $pdo->exec('create table '.listerQuote($engine, $name).'.listed (id int)');
        }
    }

    $connection = Engines::savedConnection($engine, ['database' => null]);
    $connection->user()->associate(User::factory()->create());
    $connection->save();

    return $connection;
}

function listerTearDown(string $engine): void
{
    $pdo = Engines::serverPdo($engine);
    foreach (listerDatabases($engine) as $name) {
        $pdo->exec('drop database if exists '.listerQuote($engine, $name).($engine === 'pgsql' ? ' with (force)' : ''));
    }
}

/** @param  list<DatabaseEntry>  $entries */
function entryNamed(array $entries, string $name): ?DatabaseEntry
{
    return collect($entries)->firstWhere('name', $name);
}

it('lists the databases on the server', function (string $engine) {
    $connection = listerSetUp($engine);
    try {
        $entries = app(DatabaseLister::class)->list($connection)->databases;
    } finally {
        listerTearDown($engine);
    }

    $two = entryNamed($entries, 'dbzuper_test_two');
    expect(entryNamed($entries, 'dbzuper_test'))->not->toBeNull()
        ->and($two->system)->toBeFalse()
        ->and($two->openable)->toBeTrue()
        ->and($two->bytes)->toBeGreaterThan(0)
        ->and($two->tables)->toBe($engine === 'pgsql' ? null : 1);
    $names = collect($entries)->pluck('name')->all();
    expect($names)->toBe(collect($names)->sort()->values()->all());
})->with(['mysql', 'mariadb', 'pgsql']);

it('marks system databases', function (string $engine) {
    Engines::skipUnlessAvailable($engine);

    $listing = app(DatabaseLister::class)->list(Engines::savedConnection($engine, ['database' => null]));
    $entries = $listing->databases;
    expect($listing->version)->toMatch('/^\d+\.\d+/');

    if ($engine === 'pgsql') {
        expect(entryNamed($entries, 'template0'))->toBeNull()
            ->and(entryNamed($entries, 'postgres')->system)->toBeFalse()
            ->and(entryNamed($entries, 'template1')->system)->toBeTrue();
    } else {
        expect(entryNamed($entries, 'information_schema')->system)->toBeTrue()
            ->and(entryNamed($entries, 'mysql')->system)->toBeTrue()
            ->and(entryNamed($entries, 'dbzuper_test')->system)->toBeFalse();
    }
})->with(['mysql', 'mariadb', 'pgsql']);

it('takes PostgreSQL table counts from stored snapshots', function () {
    $connection = listerSetUp('pgsql');
    try {
        app(SnapshotService::class)->refresh($connection->forDatabase('dbzuper_test_two'));
        $entries = app(DatabaseLister::class)->list($connection)->databases;
    } finally {
        listerTearDown('pgsql');
    }

    expect(entryNamed($entries, 'dbzuper_test_two')->tables)->toBe(1);
});

it('opens a database whose name has a dash', function (string $engine) {
    $connection = listerSetUp($engine);
    try {
        $snapshot = app(SnapshotService::class)->refresh($connection->forDatabase('dbzuper_test-three'));
    } finally {
        listerTearDown($engine);
    }

    expect(collect($snapshot->payload['tables'])->pluck('name')->all())->toContain('listed')
        ->and($snapshot->database)->toBe('dbzuper_test-three');
})->with(['mysql', 'mariadb']);

it('still lists names when sizes and counts fail', function () {
    Engines::skipUnlessAvailable('mysql');
    app()->bind(MySqlDriver::class, fn () => new class extends MySqlDriver
    {
        public function databaseStats(Connection $db): array
        {
            throw new RuntimeException('stats unavailable');
        }
    });

    $entries = app(DatabaseLister::class)->list(Engines::savedConnection('mysql', ['database' => null]))->databases;

    expect(entryNamed($entries, 'dbzuper_test'))->not->toBeNull()
        ->and(entryNamed($entries, 'dbzuper_test')->bytes)->toBeNull()
        ->and(entryNamed($entries, 'dbzuper_test')->tables)->toBeNull();
});

it('reports a database the login may not open as a database error', function () {
    $connection = listerSetUp('pgsql');
    $pdo = Engines::serverPdo('pgsql');
    $pdo->exec('drop role if exists dbzuper_test_limited');
    $pdo->exec("create role dbzuper_test_limited login password 'limited'");
    $pdo->exec('revoke connect on database dbzuper_test_two from public');
    $connection->forceFill(['username' => 'dbzuper_test_limited', 'password' => 'limited'])->save();

    try {
        $response = $this->actingAs($connection->user)->getJson('/api/c/'.$connection->id.':dbzuper_test_two/schema');
    } finally {
        listerTearDown('pgsql');
        $pdo->exec('drop role if exists dbzuper_test_limited');
    }

    $response->assertStatus(422)->assertJsonStructure(['error' => ['kind', 'message']]);
});
