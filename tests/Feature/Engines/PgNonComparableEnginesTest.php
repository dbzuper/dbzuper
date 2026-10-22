<?php

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Editing\EditMethod;
use App\Database\Editing\EditMethodResolver;
use App\Database\Schema\SnapshotService;
use App\Models\SavedConnection;
use App\Models\User;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

afterEach(fn () => Engines::resetSqlite());

/** PostgreSQL types without a btree `=` (jsonpath, txid_snapshot) and a domain over json: never compared with `=`. */
function nonComparableSetup(Connection $db): void
{
    nonComparableDrop($db);
    $db->statement('CREATE DOMAIN nc_json AS json');
    $db->statement('CREATE DOMAIN nc_json2 AS nc_json');
    $db->statement('CREATE TABLE nc_ctid (note VARCHAR(40), qty INT NOT NULL, path jsonpath, doc nc_json, deep nc_json2, snap txid_snapshot, paths jsonpath[])');
    $db->statement('CREATE TABLE nc_pk (id INT PRIMARY KEY, note VARCHAR(40), path jsonpath, doc nc_json)');
    foreach ([1, 2, 3] as $n) {
        $db->insert("INSERT INTO nc_ctid VALUES (?, ?, '$.a', '{\"a\": 1}', '[1]', txid_current_snapshot(), ARRAY['$.b']::jsonpath[])", ['n'.$n, $n]);
        $db->insert("INSERT INTO nc_pk VALUES (?, ?, '$.a', '{\"a\": 1}')", [$n, 'n'.$n]);
    }
}

function nonComparableDrop(Connection $db): void
{
    $db->statement('DROP TABLE IF EXISTS nc_ctid, nc_pk CASCADE');
    $db->statement('DROP DOMAIN IF EXISTS nc_json2, nc_json CASCADE');
}

function nonComparableRows(SavedConnection $saved, string $table): array
{
    $res = test()->actingAs($saved->user)->postJson(route('api.tables.rows', [$saved, $table]), ['sort' => [['column' => 'note', 'direction' => 'asc']]])->assertOk();
    $names = array_column($res->json('columns'), 'name');

    return array_map(fn ($id, $row) => ['id' => $id, 'row' => array_combine($names, $row)], $res->json('row_ids'), $res->json('rows'));
}

function nonComparableCommit(SavedConnection $saved, string $table, array $changes)
{
    return test()->actingAs($saved->user)->postJson(route('api.tables.changes', [$saved, $table]), ['preview' => false, 'changes' => $changes]);
}

it('lists columns without a btree = (domains resolved to their base type) as not comparable', function () {
    Engines::skipUnlessAvailable('pgsql');
    $saved = Engines::savedConnection('pgsql');
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        nonComparableSetup($db);
        $tables = collect(app(DriverRegistry::class)->for($saved->driver)->inspector()->inspect($db, $saved)->toArray()['tables'])->keyBy('name');
        $ctid = (new EditMethodResolver)->resolve($saved, $tables['nc_ctid'], $db);
        $pk = (new EditMethodResolver)->resolve($saved, $tables['nc_pk'], $db);

        expect($ctid->method)->toBe(EditMethod::PgCtid)
            ->and($ctid->nonComparableColumns)->toBe(['path', 'doc', 'deep', 'snap', 'paths'])
            ->and($pk->nonComparableColumns)->toBe(['path', 'doc']);
    } finally {
        nonComparableDrop($db);
        $factory->release($db);
    }
});

it('updates and deletes rows of a ctid table and writes non-comparable columns of a key table', function () {
    Engines::skipUnlessAvailable('pgsql');
    $saved = Engines::savedConnection('pgsql');
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $factory->using($saved, fn (Connection $db) => nonComparableSetup($db));

    try {
        app(SnapshotService::class)->refresh($saved);

        [$a, $b] = nonComparableRows($saved, 'nc_ctid');
        nonComparableCommit($saved, 'nc_ctid', [
            ['op' => 'update', 'id' => $a['id'], 'original' => $a['row'], 'values' => ['note' => 'x', 'path' => '$.z']],
            ['op' => 'delete', 'id' => $b['id'], 'original' => $b['row']],
        ])->assertOk()->assertJsonPath('applied', ['inserted' => 0, 'updated' => 1, 'deleted' => 1]);

        [$k] = nonComparableRows($saved, 'nc_pk');
        nonComparableCommit($saved, 'nc_pk', [
            ['op' => 'update', 'id' => $k['id'], 'original' => $k['row'], 'values' => ['path' => '$.y', 'doc' => '{"b": 2}', 'note' => 'y']],
        ])->assertOk()->assertJsonPath('applied.updated', 1);

        $state = $factory->using($saved, fn (Connection $db) => [
            array_map(fn ($r) => [$r->note, $r->path], $db->select('select note, path::text as path from nc_ctid order by qty')),
            array_map(fn ($r) => [$r->note, $r->path, $r->doc], $db->select('select note, path::text as path, doc::text as doc from nc_pk order by id')),
        ]);
        expect($state[0])->toBe([['x', '$."z"'], ['n3', '$."a"']])
            ->and($state[1])->toBe([['y', '$."y"', '{"b": 2}'], ['n2', '$."a"', '{"a": 1}'], ['n3', '$."a"', '{"a": 1}']]);
    } finally {
        $factory->using($saved, fn (Connection $db) => nonComparableDrop($db));
    }
});
