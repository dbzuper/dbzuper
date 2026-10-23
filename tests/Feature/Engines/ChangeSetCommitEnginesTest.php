<?php

use App\Database\ConnectionFactory;
use App\Database\Editing\BuiltStatement;
use App\Database\Editing\ChangeSetRunner;
use App\Database\Editing\RowMismatch;
use App\Models\SavedConnection;
use App\Models\User;
use Illuminate\Database\Connection;
use Illuminate\Testing\TestResponse;
use Tests\Support\Engines;

afterEach(fn () => Engines::resetSqlite());

const COMMIT_TABLES = ['cc_pk', 'cc_unique', 'cc_bare', 'cc_same'];

function commitDrop(Connection $db): void
{
    foreach (COMMIT_TABLES as $table) {
        $db->statement('DROP TABLE IF EXISTS '.$table.($db->getDriverName() === 'pgsql' ? ' CASCADE' : ''));
    }
}

function commitEngine(string $engine, bool $history = true): SavedConnection
{
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine, ['store_history' => $history]);
    $saved->user()->associate(User::factory()->create())->save();

    return $saved;
}

/** Creates the commit tables (one per edit method: primary key, unique index, none), runs $body, always drops them. */
function withCommitTables(SavedConnection $saved, Closure $body): void
{
    $factory = app(ConnectionFactory::class);
    $factory->using($saved, function (Connection $db) {
        commitDrop($db);
        $db->statement('CREATE TABLE cc_pk (id INT NOT NULL PRIMARY KEY, note VARCHAR(40), qty INT NOT NULL)');
        $db->statement('CREATE TABLE cc_unique (code VARCHAR(20) NOT NULL, note VARCHAR(40), qty INT NOT NULL)');
        $db->statement('CREATE UNIQUE INDEX cc_unique_code ON cc_unique (code)');
        $db->statement('CREATE TABLE cc_bare (note VARCHAR(40), qty INT NOT NULL)');
        $db->statement('CREATE TABLE cc_same (note VARCHAR(40), qty INT NOT NULL)');
        foreach ([1 => 'a', 2 => 'b', 3 => 'c'] as $qty => $note) {
            $db->table('cc_pk')->insert(['id' => $qty, 'note' => $note, 'qty' => $qty]);
            $db->table('cc_unique')->insert(['code' => 'k'.$qty, 'note' => $note, 'qty' => $qty]);
            $db->table('cc_bare')->insert(['note' => $note, 'qty' => $qty]);
            $db->table('cc_same')->insert(['note' => 'same', 'qty' => 1]);
        }
    });

    try {
        $body();
    } finally {
        $factory->using($saved, fn (Connection $db) => commitDrop($db));
    }
}

/** @return list<array{id: mixed, row: array<string, mixed>}> the rows as the grid loads them, by qty */
function commitRows(SavedConnection $saved, string $table): array
{
    $res = test()->actingAs($saved->user)->postJson(route('api.tables.rows', [$saved, $table]), ['sort' => [['column' => 'qty', 'direction' => 'asc']]])->assertOk();
    $names = array_column($res->json('columns'), 'name');

    return array_map(fn ($id, $row) => ['id' => $id, 'row' => array_combine($names, $row)], $res->json('row_ids'), $res->json('rows'));
}

function commitChanges(SavedConnection $saved, string $table, array $changes): TestResponse
{
    return test()->actingAs($saved->user)->postJson(route('api.tables.changes', [$saved, $table]), ['preview' => false, 'changes' => $changes]);
}

/** @return list<array{0: ?string, 1: int}> [note, qty] of every row, by qty then note */
function commitState(SavedConnection $saved, string $table): array
{
    return app(ConnectionFactory::class)->using($saved, fn (Connection $db) => array_map(
        fn ($r) => [$r->note, (int) $r->qty],
        $db->select("select note, qty from {$table} order by qty, note"),
    ));
}

/** A new row for the table; $qty null violates NOT NULL. */
function commitNewRow(string $table, int $n, ?string $qty): array
{
    return ['op' => 'insert', 'values' => match ($table) {
        'cc_pk' => ['id' => (string) $n, 'note' => 'n', 'qty' => $qty],
        'cc_unique' => ['code' => 'k'.$n, 'note' => 'n', 'qty' => $qty],
        default => ['note' => 'n', 'qty' => $qty],
    }];
}

it('commits updates, deletes and inserts with each edit method', function (string $engine, string $table) {
    $saved = commitEngine($engine);

    withCommitTables($saved, function () use ($saved, $table) {
        [$a, $b] = commitRows($saved, $table);

        $res = commitChanges($saved, $table, [
            ['op' => 'update', 'id' => $a['id'], 'original' => $a['row'], 'values' => ['note' => 'x']],
            ['op' => 'delete', 'id' => $b['id'], 'original' => $b['row']],
            commitNewRow($table, 4, '4'),
        ])->assertOk();

        expect($res->json())->toBe(['applied' => ['inserted' => 1, 'updated' => 1, 'deleted' => 1]])
            ->and(commitState($saved, $table))->toBe([['x', 1], ['c', 3], ['n', 4]]);

        // Setting a value to what it already is still matches (and so counts) one row, MySQL/MariaDB included.
        [$x] = commitRows($saved, $table);
        commitChanges($saved, $table, [['op' => 'update', 'id' => $x['id'], 'original' => $x['row'], 'values' => ['note' => 'x']]])
            ->assertOk()->assertJsonPath('applied.updated', 1);
    });
})->with(Engines::ENGINES)->with(['cc_pk', 'cc_unique', 'cc_bare']);

it('rolls everything back when a row changed since it was loaded', function (string $engine, string $table) {
    $saved = commitEngine($engine);

    withCommitTables($saved, function () use ($saved, $table) {
        [$a, , $c] = commitRows($saved, $table);
        app(ConnectionFactory::class)->using($saved, fn (Connection $db) => $db->update("update {$table} set note = 'other' where qty = 1"));

        $res = commitChanges($saved, $table, [
            ['op' => 'delete', 'id' => $c['id'], 'original' => $c['row']],
            ['op' => 'update', 'id' => $a['id'], 'original' => $a['row'], 'values' => ['note' => 'x']],
            commitNewRow($table, 4, '4'),
        ])->assertStatus(409);

        expect($res->json())->toBe(['error' => ['kind' => 'row_mismatch', 'message' => 'row changed since you loaded it', 'index' => 1, 'reason' => 'changed']])
            ->and(commitState($saved, $table))->toBe([['other', 1], ['b', 2], ['c', 3]])
            ->and($saved->history()->count())->toBe(0);
    });
})->with(Engines::ENGINES)->with(['cc_pk', 'cc_unique', 'cc_bare']);

it('rolls everything back when a statement fails, reporting that change', function (string $engine, string $table) {
    $saved = commitEngine($engine);

    withCommitTables($saved, function () use ($saved, $table) {
        [$a] = commitRows($saved, $table);

        $res = commitChanges($saved, $table, [
            ['op' => 'update', 'id' => $a['id'], 'original' => $a['row'], 'values' => ['note' => 'x']],
            commitNewRow($table, 4, null), // qty is NOT NULL
        ])->assertUnprocessable();

        expect($res->json('index'))->toBe(1)
            ->and($res->json('error.message'))->toBeString()->not->toBe('')
            ->and($res->json('error'))->toHaveKeys(['kind', 'message', 'sqlstate', 'reason'])
            ->and(commitState($saved, $table))->toBe([['a', 1], ['b', 2], ['c', 3]])
            ->and($saved->history()->count())->toBe(0);
    });
})->with(Engines::ENGINES)->with(['cc_pk', 'cc_unique', 'cc_bare']);

it('deletes a row and re-adds one with the same key in one commit', function (string $engine, string $table) {
    $saved = commitEngine($engine);

    withCommitTables($saved, function () use ($saved, $table) {
        [, $b] = commitRows($saved, $table);
        $again = $table === 'cc_pk' ? ['id' => '2', 'note' => 'again', 'qty' => '2'] : ['code' => 'k2', 'note' => 'again', 'qty' => '2'];

        // Sent insert first: the server orders deletes before inserts.
        commitChanges($saved, $table, [
            ['op' => 'insert', 'values' => $again],
            ['op' => 'delete', 'id' => $b['id'], 'original' => $b['row']],
        ])->assertOk()->assertJsonPath('applied', ['inserted' => 1, 'updated' => 0, 'deleted' => 1]);

        expect(commitState($saved, $table))->toBe([['a', 1], ['again', 2], ['c', 3]]);
    });
})->with(Engines::ENGINES)->with(['cc_pk', 'cc_unique']);

it('changes exactly one of three identical rows on MySQL/MariaDB', function (string $engine) {
    $saved = commitEngine($engine);

    withCommitTables($saved, function () use ($saved) {
        $rows = commitRows($saved, 'cc_same');
        expect($rows)->toHaveCount(3)->and(array_unique(array_map(fn ($r) => json_encode($r['id']), $rows)))->toHaveCount(1);

        commitChanges($saved, 'cc_same', [['op' => 'update', 'id' => $rows[0]['id'], 'original' => $rows[0]['row'], 'values' => ['qty' => '2']]])
            ->assertOk()->assertJsonPath('applied.updated', 1);
        expect(commitState($saved, 'cc_same'))->toBe([['same', 1], ['same', 1], ['same', 2]]);

        // Setting a value to what it already is: matched, not changed, still counts as one.
        commitChanges($saved, 'cc_same', [['op' => 'update', 'id' => $rows[0]['id'], 'original' => $rows[0]['row'], 'values' => ['qty' => '1']]])
            ->assertOk()->assertJsonPath('applied.updated', 1);
        commitChanges($saved, 'cc_same', [['op' => 'delete', 'id' => $rows[0]['id'], 'original' => $rows[0]['row']]])
            ->assertOk()->assertJsonPath('applied.deleted', 1);
        expect(commitState($saved, 'cc_same'))->toBe([['same', 1], ['same', 2]]);
    });
})->with(['mysql', 'mariadb']);

it('deletes exactly two of three identical rows when two are marked in one change set', function (string $engine) {
    $saved = commitEngine($engine);

    withCommitTables($saved, function () use ($saved) {
        [$a, , $c] = commitRows($saved, 'cc_same');
        expect($a['id'])->toBe($c['id']);

        commitChanges($saved, 'cc_same', [
            ['op' => 'delete', 'id' => $a['id'], 'original' => []],
            ['op' => 'delete', 'id' => $c['id'], 'original' => []],
        ])->assertOk()->assertJsonPath('applied', ['inserted' => 0, 'updated' => 0, 'deleted' => 2]);
        expect(commitState($saved, 'cc_same'))->toBe([['same', 1]]);
    });
})->with(['mysql', 'mariadb']);

it('keeps the SQL editor counting changed rows on MySQL/MariaDB', function (string $engine) {
    $saved = commitEngine($engine);

    withCommitTables($saved, function () use ($saved) {
        $res = test()->actingAs($saved->user)->postJson(route('api.query.run', $saved), ['statements' => [['sql' => "update cc_pk set note = 'a' where id = 1", 'confirmed' => true]]])->assertOk();
        expect($res->json('results.0.affected'))->toBe(0);

        [$a] = commitRows($saved, 'cc_pk');
        commitChanges($saved, 'cc_pk', [['op' => 'update', 'id' => $a['id'], 'original' => $a['row'], 'values' => ['note' => 'a']]])
            ->assertOk()->assertJsonPath('applied.updated', 1);
    });
})->with(['mysql', 'mariadb']);

it('rolls back a statement that matches more than one row', function (string $engine) {
    $saved = commitEngine($engine);

    withCommitTables($saved, function () use ($saved) {
        $statements = [
            new BuiltStatement(0, 'update', 'UPDATE cc_pk SET note = ? WHERE id = ?', ['x', '1'], "UPDATE cc_pk SET note = 'x' WHERE id = 1", 'id = 1'),
            new BuiltStatement(3, 'update', 'UPDATE cc_pk SET note = ? WHERE qty > ?', ['y', '1'], "UPDATE cc_pk SET note = 'y' WHERE qty > 1", 'qty > 1'),
        ];

        try {
            app(ConnectionFactory::class)->using($saved, fn (Connection $db) => app(ChangeSetRunner::class)->commit($saved, $db, $statements), countMatchedRows: true);
            $this->fail('expected a row mismatch');
        } catch (RowMismatch $e) {
            expect([$e->index, $e->reason, $e->getMessage()])->toBe([3, 'multiple', 'matched more than one row']);
        }

        expect(commitState($saved, 'cc_pk'))->toBe([['a', 1], ['b', 2], ['c', 3]]);
    });
})->with(Engines::ENGINES);

it('records each committed statement in history once, as previewed', function (string $engine) {
    $saved = commitEngine($engine);

    withCommitTables($saved, function () use ($saved) {
        [$a, $b] = commitRows($saved, 'cc_pk');
        $changes = [
            ['op' => 'update', 'id' => $a['id'], 'original' => $a['row'], 'values' => ['note' => "it's"]],
            ['op' => 'delete', 'id' => $b['id'], 'original' => $b['row']],
            commitNewRow('cc_pk', 4, '4'),
        ];
        $preview = test()->actingAs($saved->user)->postJson(route('api.tables.changes', [$saved, 'cc_pk']), ['preview' => true, 'changes' => $changes])->assertOk();

        commitChanges($saved, 'cc_pk', $changes)->assertOk();

        $history = $saved->history()->orderBy('id')->get();
        expect($history->pluck('sql')->all())->toBe(array_column($preview->json('statements'), 'sql'))
            ->and($history->pluck('status')->unique()->all())->toBe(['ok'])
            ->and($history->pluck('kind')->unique()->all())->toBe(['write'])
            ->and($history->pluck('affected')->all())->toBe([1, 1, 1]);
    });
})->with(Engines::ENGINES);

it('records no history when the connection does not store it', function (string $engine) {
    $saved = commitEngine($engine, history: false);

    withCommitTables($saved, function () use ($saved) {
        [$a] = commitRows($saved, 'cc_pk');
        commitChanges($saved, 'cc_pk', [['op' => 'update', 'id' => $a['id'], 'original' => $a['row'], 'values' => ['note' => 'x']]])->assertOk();

        expect(commitState($saved, 'cc_pk')[0])->toBe(['x', 1])
            ->and($saved->history()->count())->toBe(0);
    });
})->with(Engines::ENGINES);
