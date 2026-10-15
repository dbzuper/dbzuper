<?php

use App\Database\Query\HistoryRecorder;
use App\Database\Sql\StatementClassifier;
use App\Enums\DriverName;
use App\Models\QueryHistoryEntry;
use App\Models\SavedConnection;
use App\Models\User;
use App\Support\Demo\CommerceSchema;
use Illuminate\Support\Facades\DB;
use Tests\Support\Engines;

beforeEach(function () {
    $this->user = User::factory()->create();
    $path = Engines::sqlitePath();
    $db = DB::connectUsing('fixture', ['driver' => 'sqlite', 'database' => $path, 'prefix' => '', 'foreign_key_constraints' => true], force: true);
    CommerceSchema::create($db);
    DB::purge('fixture');
    $this->connection = SavedConnection::factory()->for($this->user)->create([
        'driver' => DriverName::Sqlite, 'host' => null, 'port' => null, 'database' => $path, 'username' => null, 'password' => null,
    ]);
    $this->run = fn (array $statements, array $extra = []) => $this->actingAs($this->user)
        ->postJson(route('api.query.run', $this->connection), ['statements' => $statements, ...$extra]);
});

afterEach(fn () => Engines::resetSqlite());

it('runs a read and returns columns, rows and timing', function () {
    $res = ($this->run)([['sql' => 'select id, name from users order by id']])->assertOk();

    expect($res->json('results.0.columns.*.name'))->toBe(['id', 'name'])
        ->and($res->json('results.0.rows.0'))->toBe([1, 'Ada Lovelace'])
        ->and($res->json('results.0.kind'))->toBe('read')
        ->and($res->json('results.0.duration_ms'))->toBeInt();
});

it('asks for confirmation before a write and runs it once confirmed', function () {
    ($this->run)([['sql' => "update users set name = 'x' where id = 1"]])
        ->assertStatus(409)->assertJsonPath('confirmation.mode', 'confirm')->assertJsonPath('confirmation.statement_index', 0);

    ($this->run)([['sql' => "update users set name = 'x' where id = 1", 'confirmed' => true]])
        ->assertOk()->assertJsonPath('results.0.affected', 1);
});

it('requires the typed target for destructive statements', function () {
    ($this->run)([['sql' => 'delete from audit_log', 'confirmed' => true]])
        ->assertStatus(409)->assertJsonPath('confirmation.mode', 'typed')->assertJsonPath('confirmation.target', 'audit_log');

    ($this->run)([['sql' => 'delete from audit_log', 'typed' => 'AUDIT_LOG']])->assertStatus(409);
    ($this->run)([['sql' => 'delete from audit_log', 'typed' => 'audit_log']])->assertOk()->assertJsonPath('results.0.affected', 1);
});

it('rejects anything but reads and transactions on read-only connections, before running anything', function (string $sql) {
    $this->connection->update(['read_only' => true]);

    ($this->run)([['sql' => 'select 1'], ['sql' => $sql, 'confirmed' => true, 'typed' => 'users']])
        ->assertStatus(422)->assertJsonPath('error.kind', 'readonly')->assertJsonPath('error.statement_index', 1);

    expect(QueryHistoryEntry::count())->toBe(0);
})->with([
    'update' => ["update users set name = 'x' where id = 1"],
    'pragma set' => ['pragma foreign_keys = off'],
    'with delete' => ['with d as (delete from users returning *) select * from d'],
    'begin read write' => ['begin read write'],
    'set transaction read write' => ['set transaction read write'],
    'start transaction read write' => ['start transaction read write'],
    'select into' => ['select * into new_t from users'],
    'explain analyze delete' => ['explain analyze delete from users'],
]);

it('allows transactions on read-only connections', function () {
    $this->connection->update(['read_only' => true]);

    ($this->run)([['sql' => 'begin'], ['sql' => 'select 1'], ['sql' => 'commit']])->assertOk()->assertJsonCount(3, 'results');
});

it('rejects an item containing more than one statement', function () {
    ($this->run)([['sql' => 'select 1; select 2']])->assertUnprocessable()->assertJsonValidationErrors('statements.0.sql');
});

it('stops at the first error, keeps earlier results and rolls back an open transaction', function () {
    $res = ($this->run)([
        ['sql' => 'begin'],
        ['sql' => "update users set name = 'changed' where id = 1", 'confirmed' => true],
        ['sql' => 'select * from no_such_table'],
        ['sql' => 'select 3'],
    ])->assertOk();

    expect($res->json('results'))->toHaveCount(3)
        ->and($res->json('results.2.error.kind'))->not->toBeNull()
        ->and(DB::connectUsing('check', ['driver' => 'sqlite', 'database' => $this->connection->database, 'prefix' => ''], force: true)
            ->table('users')->where('id', 1)->value('name'))->toBe('Ada Lovelace');
    DB::purge('check');
});

it('records history per statement unless disabled', function () {
    ($this->run)([['sql' => 'select 1'], ['sql' => 'select * from nope']]);
    expect(QueryHistoryEntry::where('connection_id', $this->connection->id)->pluck('status')->all())->toBe(['ok', 'error']);

    $this->connection->update(['store_history' => false]);
    ($this->run)([['sql' => 'select 2']]);
    expect(QueryHistoryEntry::count())->toBe(2);
});

it('prunes history beyond the configured size', function () {
    config(['dbsuperb.history_keep' => 3]);
    foreach (range(1, 5) as $i) {
        ($this->run)([['sql' => "select {$i}"]]);
    }
    app(HistoryRecorder::class)->prune($this->connection);

    expect(QueryHistoryEntry::where('connection_id', $this->connection->id)->orderBy('id')->pluck('sql')->all())->toBe(['select 3', 'select 4', 'select 5']);
});

it('validates limits', function () {
    ($this->run)(array_fill(0, 51, ['sql' => 'select 1']))->assertUnprocessable()->assertJsonValidationErrors('statements');
    ($this->run)([['sql' => 'select 1']], ['max_rows' => 10001])->assertUnprocessable()->assertJsonValidationErrors('max_rows');
});

it('explains a statement without executing it', function () {
    $res = $this->actingAs($this->user)->postJson(route('api.query.explain', $this->connection), ['sql' => 'delete from audit_log'])->assertOk();

    expect($res->json('results.0.columns'))->not->toBeEmpty();
    expect(DB::connectUsing('check', ['driver' => 'sqlite', 'database' => $this->connection->database, 'prefix' => ''], force: true)->table('audit_log')->count())->toBe(1);
    DB::purge('check');
});

it('forbids other users', function () {
    $this->actingAs(User::factory()->create())->postJson(route('api.query.run', $this->connection), ['statements' => [['sql' => 'select 1']]])->assertForbidden();
});

it('returns a syntax error with a position', function () {
    $res = ($this->run)([['sql' => 'select * form users']])->assertOk();

    expect($res->json('results.0.error.kind'))->toBe('syntax');
});

it('refuses to explain statements that would execute', function (string $sql) {
    $this->actingAs($this->user)->postJson(route('api.query.explain', $this->connection), ['sql' => $sql])
        ->assertUnprocessable()->assertJsonValidationErrors('sql');

    expect(DB::connectUsing('check', ['driver' => 'sqlite', 'database' => $this->connection->database, 'prefix' => ''], force: true)->table('audit_log')->count())->toBe(1);
    DB::purge('check');
})->with([
    'analyze' => ['analyze delete from audit_log'],
    'parenthesised analyze' => ['(analyze) delete from audit_log'],
    'analyse' => ['analyse delete from audit_log'],
]);

it('requires typing the keyword when a destructive statement has no target', function () {
    $sql = 'delete from (select 1)';
    expect(StatementClassifier::classify($sql, 'sqlite'))->kind->toBe('destructive')->target->toBeNull();

    ($this->run)([['sql' => $sql, 'confirmed' => true]])
        ->assertStatus(409)->assertJsonPath('confirmation.mode', 'typed')->assertJsonPath('confirmation.target', 'DELETE');

    // Accepted once typed: the statement then reaches the database (and fails there on its own syntax).
    ($this->run)([['sql' => $sql, 'typed' => 'DELETE']])->assertOk();
});

it('reports a failed connection as one failed result', function () {
    $this->connection->update(['database' => dirname(Engines::sqlitePath()).DIRECTORY_SEPARATOR.'missing-'.uniqid().'.sqlite']);

    $res = ($this->run)([['sql' => 'select 1'], ['sql' => 'select 2']])->assertOk();

    expect($res->json('results'))->toHaveCount(1)
        ->and($res->json('results.0.sql'))->toBe('select 1')
        ->and($res->json('results.0.error.kind'))->not->toBeNull();
    expect(QueryHistoryEntry::where('connection_id', $this->connection->id)->count())->toBe(1);
});
