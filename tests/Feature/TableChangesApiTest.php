<?php

use App\Database\CellValue;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\User;
use App\Support\Demo\CommerceSchema;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
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
    $this->changes = fn (string $table, array $changes, array $extra = []): TestResponse => $this->actingAs($this->user)
        ->postJson(route('api.tables.changes', [$this->connection, $table]), $extra + ['preview' => true, 'changes' => $changes]);
});

afterEach(fn () => Engines::resetSqlite());

function fixturePdo(): PDO
{
    $pdo = new PDO('sqlite:'.Engines::sqlitePath());
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    return $pdo;
}

it('previews a change set in execution order with targets, without running it', function () {
    $res = ($this->changes)('users', [
        ['op' => 'insert', 'values' => ['name' => "O'Neil", 'email' => 'o@example.com']],
        ['op' => 'update', 'id' => ['key' => ['id' => 2]], 'original' => ['name' => 'Alan Turing'], 'values' => ['name' => 'Alan M. Turing']],
        ['op' => 'delete', 'id' => ['key' => ['id' => 3]], 'original' => ['name' => 'Grace Hopper']],
    ])->assertOk();

    expect($res->json('statements'))->toBe([
        ['index' => 2, 'op' => 'delete', 'sql' => 'DELETE FROM "users" WHERE "id" = 3', 'target' => 'id = 3'],
        ['index' => 1, 'op' => 'update', 'sql' => 'UPDATE "users" SET "name" = \'Alan M. Turing\' WHERE "id" = 2 AND "name" = \'Alan Turing\'', 'target' => 'id = 2'],
        ['index' => 0, 'op' => 'insert', 'sql' => 'INSERT INTO "users" ("name", "email") VALUES (\'O\'\'Neil\', \'o@example.com\')', 'target' => 'new row'],
    ]);

    // Nothing ran; and each previewed statement is valid SQL that touches exactly one row.
    $pdo = fixturePdo();
    expect($pdo->query('select count(*) from users')->fetchColumn())->toBe(3)
        ->and($pdo->query('select name from users where id = 2')->fetchColumn())->toBe('Alan Turing');
    $pdo->beginTransaction();
    foreach ($res->json('statements') as $statement) {
        expect($pdo->exec($statement['sql']))->toBe(1);
    }
    $pdo->rollBack();
});

it('pins rows with the identities the rows endpoint returns', function () {
    fixturePdo()->exec("INSERT INTO audit_log (event, payload) VALUES ('same', 'p'), ('same', 'p')");
    $rows = $this->actingAs($this->user)->postJson(route('api.tables.rows', [$this->connection, 'audit_log']))->assertOk();
    $id = $rows->json('row_ids.2');

    $res = ($this->changes)('audit_log', [['op' => 'update', 'id' => $id, 'original' => ['event' => 'same'], 'values' => ['event' => 'changed']]])->assertOk();

    expect($res->json('statements.0.target'))->toBe('rowid 3')
        ->and($res->json('statements.0.sql'))->toBe('UPDATE "audit_log" SET "event" = \'changed\' WHERE rowid = 3 AND "event" = \'same\'');
    $pdo = fixturePdo();
    $pdo->beginTransaction();
    expect($pdo->exec($res->json('statements.0.sql')))->toBe(1);
    $pdo->rollBack();
});

it('keeps values exactly as typed: no trimming, empty text stays text', function () {
    $res = ($this->changes)('users', [['op' => 'insert', 'values' => ['name' => '  padded  ', 'email' => '', 'profile' => null]]])->assertOk();

    expect($res->json('statements.0.sql'))->toBe('INSERT INTO "users" ("name", "email", "profile") VALUES (\'  padded  \', \'\', null)');
});

it('accepts column names containing dots', function () {
    fixturePdo()->exec('CREATE TABLE "dotted" ("id" integer primary key, "a.b" text, "c*" text)');

    $res = ($this->changes)('dotted', [['op' => 'update', 'id' => ['key' => ['id' => 1]], 'original' => ['a.b' => 'x', 'c*' => null], 'values' => ['a.b' => 'y', 'c*' => 'z']]])->assertOk();

    expect($res->json('statements.0.sql'))->toBe('UPDATE "dotted" SET "a.b" = \'y\', "c*" = \'z\' WHERE "id" = 1 AND "a.b" = \'x\' AND "c*" IS NULL');
});

it('rejects what the grid would not allow', function (string $table, array $change, string $field) {
    ($this->changes)($table, [$change])->assertUnprocessable()->assertJsonValidationErrors($field);
})->with([
    'unknown column' => ['users', ['op' => 'insert', 'values' => ['nope' => '1']], 'changes.0.values'],
    'binary column' => ['users', ['op' => 'update', 'id' => ['key' => ['id' => 1]], 'original' => ['avatar' => null], 'values' => ['avatar' => 'x']], 'changes.0.values'],
    'view' => ['order_totals', ['op' => 'insert', 'values' => ['total' => '1']], 'changes'],
    'missing identity' => ['users', ['op' => 'delete'], 'changes.0.id'],
    'identity of another method' => ['users', ['op' => 'delete', 'id' => ['rowid' => '1']], 'changes.0.id'],
    'shortened original' => ['users', ['op' => 'update', 'id' => ['key' => ['id' => 1]], 'original' => ['name' => str_repeat('x', CellValue::RESULT_CHARS + 1)], 'values' => ['name' => 'b']], 'changes.0.original'],
    'unknown op' => ['users', ['op' => 'merge'], 'changes.0.op'],
    'values not an object' => ['users', ['op' => 'insert', 'values' => 'x'], 'changes.0.values'],
]);

it('bounds the request', function () {
    $insert = ['op' => 'insert', 'values' => ['name' => 'a', 'email' => 'a@example.com']];

    ($this->changes)('users', array_fill(0, 501, $insert))->assertUnprocessable()->assertJsonValidationErrors('changes');
    ($this->changes)('users', [])->assertUnprocessable()->assertJsonValidationErrors('changes');
    ($this->changes)('users', [$insert], ['preview' => 'yes please'])->assertUnprocessable()->assertJsonValidationErrors('preview');
    ($this->changes)('users', [['op' => 'insert', 'values' => ['name' => str_repeat('x', 1_000_001)]]])
        ->assertUnprocessable()->assertJsonValidationErrors('changes.0.values');
    ($this->changes)('nope', [$insert])->assertNotFound();
});

it('refuses read-only connections with the reason, before running anything', function () {
    $this->connection->update(['read_only' => true]);
    $insert = ['op' => 'insert', 'values' => ['name' => 'a', 'email' => 'ro@example.com']];

    ($this->changes)('users', [$insert])
        ->assertForbidden()->assertJsonPath('message', 'this connection is read-only');
    ($this->changes)('users', [$insert], ['preview' => false])
        ->assertForbidden()->assertJsonPath('message', 'this connection is read-only');
    expect(fixturePdo()->query('select count(*) from users')->fetchColumn())->toBe(3);
});

it('refuses a request that leaves preview out, writing nothing', function () {
    $this->actingAs($this->user)->postJson(route('api.tables.changes', [$this->connection, 'users']), ['changes' => [
        ['op' => 'insert', 'values' => ['name' => 'x', 'email' => 'x@example.com']],
    ]])->assertUnprocessable()->assertJsonValidationErrors('preview');

    expect(fixturePdo()->query('select count(*) from users')->fetchColumn())->toBe(3)
        ->and($this->connection->history()->count())->toBe(0);
});

it('commits when preview is false, and returns the counts', function () {
    $res = ($this->changes)('users', [
        ['op' => 'insert', 'values' => ['name' => "O'Neil", 'email' => 'o@example.com']],
        ['op' => 'update', 'id' => ['key' => ['id' => 2]], 'original' => ['name' => 'Alan Turing'], 'values' => ['name' => 'Alan M. Turing']],
    ], ['preview' => false])->assertOk();

    expect($res->json())->toBe(['applied' => ['inserted' => 1, 'updated' => 1, 'deleted' => 0]]);
    $pdo = fixturePdo();
    expect($pdo->query('select name from users where id = 2')->fetchColumn())->toBe('Alan M. Turing')
        ->and($pdo->query("select count(*) from users where email = 'o@example.com'")->fetchColumn())->toBe(1)
        ->and($this->connection->history()->orderBy('id')->pluck('sql')->all())->toBe([
            <<<'SQL'
            UPDATE "users" SET "name" = 'Alan M. Turing' WHERE "id" = 2 AND "name" = 'Alan Turing'
            SQL,
            <<<'SQL'
            INSERT INTO "users" ("name", "email") VALUES ('O''Neil', 'o@example.com')
            SQL,
        ]);
});

it('reports a row changed since loading with its index, writing nothing', function () {
    $res = ($this->changes)('users', [
        ['op' => 'insert', 'values' => ['name' => 'new', 'email' => 'new@example.com']],
        ['op' => 'update', 'id' => ['key' => ['id' => 2]], 'original' => ['name' => 'someone else'], 'values' => ['name' => 'x']],
    ], ['preview' => false])->assertStatus(409);

    expect($res->json('error'))->toBe(['kind' => 'row_mismatch', 'message' => 'row changed since you loaded it', 'index' => 1, 'reason' => 'changed'])
        ->and(fixturePdo()->query('select count(*) from users')->fetchColumn())->toBe(3)
        ->and($this->connection->history()->count())->toBe(0);
});

it('authorizes like the other connection endpoints', function () {
    $body = ['preview' => true, 'changes' => [['op' => 'insert', 'values' => ['name' => 'a']]]];

    $this->actingAs(User::factory()->create())->postJson(route('api.tables.changes', [$this->connection, 'users']), $body)->assertForbidden();
    auth()->logout();
    $this->postJson(route('api.tables.changes', [$this->connection, 'users']), $body)->assertUnauthorized();
});
