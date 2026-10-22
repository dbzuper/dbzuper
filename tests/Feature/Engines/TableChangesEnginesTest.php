<?php

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Editing\BuiltStatement;
use App\Database\Editing\ChangeSetBuilder;
use App\Database\Editing\EditPlanCache;
use App\Database\Schema\SnapshotService;
use App\Models\SavedConnection;
use App\Models\User;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

const CHANGE_TABLES = ['tc_part', 'tc_pk', 'tc_bare', 'tc_ts'];

function changeTablesDrop(Connection $db): void
{
    foreach (CHANGE_TABLES as $table) {
        $db->statement('DROP TABLE IF EXISTS '.$table.($db->getDriverName() === 'pgsql' ? ' CASCADE' : ''));
    }
}

function changeEngine(string $engine): SavedConnection
{
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $saved->user()->associate(User::factory()->create())->save();

    return $saved;
}

/** @return list<BuiltStatement> the statements the server would run, built exactly as the endpoint builds them */
function builtChanges(SavedConnection $saved, string $table, array $changes): array
{
    $snapshot = app(SnapshotService::class)->current($saved);
    $info = collect($snapshot->payload['tables'])->firstWhere('name', $table);

    return app(ConnectionFactory::class)->using($saved, fn (Connection $db) => app(ChangeSetBuilder::class)->build(
        app(EditPlanCache::class)->for($saved, $snapshot, $info, $db), $info, app(DriverRegistry::class)->for($saved->driver), $db, $changes,
    ));
}

/**
 * Runs each statement twice inside a rolled-back transaction, once bound and once as previewed, and returns the
 * affected-row counts plus what $after selects after the bound run.
 *
 * @param  list<BuiltStatement>  $built
 * @return array{bound: list<int>, preview: list<int>, after: mixed}
 */
function runRolledBack(SavedConnection $saved, array $built, ?Closure $after = null): array
{
    return app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($built, $after) {
        $out = ['bound' => [], 'preview' => [], 'after' => null];
        foreach (['bound', 'preview'] as $mode) {
            $db->beginTransaction();
            try {
                foreach ($built as $s) {
                    $out[$mode][] = $mode === 'bound' ? $db->affectingStatement($s->sql, $s->bindings) : $db->affectingStatement($s->previewSql);
                }
                if ($mode === 'bound' && $after !== null) {
                    $out['after'] = $after($db);
                }
            } finally {
                $db->rollBack();
            }
        }

        return $out;
    });
}

it('runs primary-key change sets bound and as previewed on every engine', function (string $engine) {
    $saved = changeEngine($engine);
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);
    $bool = $engine === 'pgsql' ? 'BOOLEAN' : 'SMALLINT';

    try {
        changeTablesDrop($db);
        $db->statement("CREATE TABLE tc_pk (id INT NOT NULL PRIMARY KEY, name VARCHAR(40), flag {$bool}, note VARCHAR(40))");
        $db->table('tc_pk')->insert([['id' => 1, 'name' => "O'Hara \\ x", 'flag' => $engine === 'pgsql' ? true : 1, 'note' => null], ['id' => 2, 'name' => 'b', 'flag' => null, 'note' => 'n']]);
        $factory->release($db);

        $rows = $this->actingAs($saved->user)->postJson(route('api.tables.rows', [$saved, 'tc_pk']), [])->assertOk();
        [$one, $two] = $rows->json('row_ids');
        $first = array_combine(array_column($rows->json('columns'), 'name'), $rows->json('rows.0'));
        $changes = [
            ['op' => 'insert', 'values' => ['id' => '3', 'name' => '', 'flag' => false]],
            ['op' => 'update', 'id' => $one, 'original' => ['name' => $first['name'], 'flag' => $first['flag'], 'note' => null], 'values' => ['name' => 'Ada', 'flag' => false, 'note' => 'x']],
            ['op' => 'delete', 'id' => $two],
        ];
        $this->actingAs($saved->user)->postJson(route('api.tables.changes', [$saved, 'tc_pk']), ['preview' => true, 'changes' => $changes])
            ->assertOk()->assertJsonPath('statements.*.op', ['delete', 'update', 'insert']);

        $run = runRolledBack($saved, builtChanges($saved, 'tc_pk', $changes), fn (Connection $db) => array_map(
            fn ($r) => array_values((array) $r), $db->select('select id, name from tc_pk order by id'),
        ));
        expect($run['bound'])->toBe([1, 1, 1])
            ->and($run['preview'])->toBe([1, 1, 1])
            ->and($run['after'])->toEqual([[1, 'Ada'], [3, '']]);

        // The optimistic check: a row changed since loading matches nothing.
        $stale = $changes[1];
        $stale['original']['name'] = 'someone else';
        expect(runRolledBack($saved, builtChanges($saved, 'tc_pk', [$stale]))['bound'])->toBe([0]);
    } finally {
        $db = $factory->make($saved);
        changeTablesDrop($db);
        $factory->release($db);
    }
})->with(['sqlite', 'mysql', 'mariadb', 'pgsql']);

it('matches MySQL/MariaDB rows by all values byte for byte, CHAR included', function (string $engine) {
    $saved = changeEngine($engine);
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        changeTablesDrop($db);
        // utf8mb4_general_ci and PAD SPACE would make 'a', 'a ' and 'A' equal; CHAR values come back without padding.
        $db->statement('CREATE TABLE tc_bare (code CHAR(5), name VARCHAR(20) COLLATE utf8mb4_general_ci, qty INT, at DATETIME NULL)');
        $db->table('tc_bare')->insert([
            ['code' => 'ab', 'name' => 'a', 'qty' => 1, 'at' => null],
            ['code' => 'ab', 'name' => 'a ', 'qty' => 1, 'at' => null],
            ['code' => 'ab', 'name' => 'A', 'qty' => 1, 'at' => null],
        ]);
        $db->statement('CREATE TABLE tc_ts (at TIMESTAMP NULL, n INT)');
        $db->table('tc_ts')->insert([['at' => '2026-10-01 12:00:00', 'n' => 1]]);
        $factory->release($db);

        $rows = $this->actingAs($saved->user)->postJson(route('api.tables.rows', [$saved, 'tc_bare']), ['sort' => [['column' => 'name', 'direction' => 'asc']]])->assertOk();
        $ids = collect($rows->json('row_ids'))->keyBy(fn ($id) => $id['values']['name']);
        expect($ids['a ']['values']['code'])->toBe('ab');

        $names = fn (Connection $db) => array_column(array_map(fn ($r) => (array) $r, $db->select('select name, qty from tc_bare order by cast(name as binary)')), 'qty', 'name');
        $run = runRolledBack($saved, builtChanges($saved, 'tc_bare', [
            ['op' => 'delete', 'id' => $ids['a ']],
            ['op' => 'update', 'id' => $ids['A'], 'original' => ['qty' => 1], 'values' => ['qty' => '5']],
        ]), $names);
        expect($run['bound'])->toBe([1, 1])
            ->and($run['preview'])->toBe([1, 1])
            ->and($run['after'])->toBe(['A' => 5, 'a' => 1]);

        // TIMESTAMP is shown in the session time zone, ambiguous across a DST fall-back: such rows can't be pinned.
        $ts = $this->actingAs($saved->user)->postJson(route('api.tables.rows', [$saved, 'tc_ts']), [])->assertOk();
        expect($ts->json('row_ids'))->toBe([null])->and($ts->json('locked.0'))->toBe([0]);
        $this->actingAs($saved->user)->postJson(route('api.tables.changes', [$saved, 'tc_ts']), ['preview' => true, 'changes' => [
            ['op' => 'delete', 'id' => ['values' => ['at' => '2026-10-01 12:00:00', 'n' => 1]]],
        ]])->assertUnprocessable()->assertJsonValidationErrors('changes.0.id');
    } finally {
        $db = $factory->make($saved);
        changeTablesDrop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb']);

it('pins PostgreSQL rows by ctid, with tableoid on partitioned tables', function () {
    $saved = changeEngine('pgsql');
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        changeTablesDrop($db);
        $db->statement('CREATE TABLE tc_bare (note TEXT, qty INT, flag BOOLEAN, f DOUBLE PRECISION, doc JSON)');
        $db->table('tc_bare')->insert([['note' => 'a', 'qty' => 1, 'flag' => true, 'f' => 0.1, 'doc' => '{"a": 1}'], ['note' => 'a', 'qty' => 1, 'flag' => true, 'f' => 0.1, 'doc' => '{}']]);
        $db->statement('CREATE TABLE tc_part (id INT NOT NULL, v TEXT) PARTITION BY RANGE (id)');
        $db->statement('CREATE TABLE tc_part_a PARTITION OF tc_part FOR VALUES FROM (0) TO (10)');
        $db->statement('CREATE TABLE tc_part_b PARTITION OF tc_part FOR VALUES FROM (10) TO (20)');
        $db->table('tc_part')->insert([['id' => 1, 'v' => 'a'], ['id' => 11, 'v' => 'b']]);
        $factory->release($db);

        $rows = $this->actingAs($saved->user)->postJson(route('api.tables.rows', [$saved, 'tc_bare']), [])->assertOk();
        $original = array_combine(array_column($rows->json('columns'), 'name'), $rows->json('rows.1'));
        $change = ['op' => 'update', 'id' => $rows->json('row_ids.1'), 'original' => $original, 'values' => ['note' => 'b', 'flag' => false]];
        $built = builtChanges($saved, 'tc_bare', [$change]);
        expect($built[0]->sql)->toContain('ctid = ?::tid AND "note" = ? AND "qty" = ? AND "flag" = ?')
            ->and($built[0]->sql)->not->toContain('"f" =')->not->toContain('"doc" =');

        $run = runRolledBack($saved, $built, fn (Connection $db) => $db->select('select note, flag from tc_bare order by ctid'));
        expect($run['bound'])->toBe([1])->and($run['preview'])->toBe([1])
            ->and(array_map(fn ($r) => [$r->note, $r->flag], $run['after']))->toBe([['a', true], ['b', false]]);

        // Once the row has changed (and so moved), the old ctid matches nothing.
        $factory->using($saved, fn (Connection $db) => $db->update("update tc_bare set qty = 2 where doc::text = '{}'"));
        expect(runRolledBack($saved, $built)['bound'])->toBe([0]);

        $part = $this->actingAs($saved->user)->postJson(route('api.tables.rows', [$saved, 'tc_part']), [])->assertOk();
        $id = $part->json('row_ids.1');
        expect($id)->toHaveKeys(['ctid', 'tableoid']);
        $res = $this->actingAs($saved->user)->postJson(route('api.tables.changes', [$saved, 'tc_part']), ['preview' => true, 'changes' => [
            ['op' => 'delete', 'id' => $id, 'original' => ['id' => 11, 'v' => 'b']],
        ]])->assertOk();
        expect($res->json('statements.0.target'))->toBe("ctid {$id['ctid']} in tableoid {$id['tableoid']}");

        $run = runRolledBack($saved, builtChanges($saved, 'tc_part', [['op' => 'delete', 'id' => $id, 'original' => ['id' => 11, 'v' => 'b']]]),
            fn (Connection $db) => array_column($db->select('select id from tc_part order by id'), 'id'));
        expect($run['bound'])->toBe([1])->and($run['preview'])->toBe([1])->and($run['after'])->toBe([1]);
    } finally {
        $db = $factory->make($saved);
        changeTablesDrop($db);
        $factory->release($db);
    }
});
