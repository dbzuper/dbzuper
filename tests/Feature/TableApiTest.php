<?php

use App\Enums\DriverName;
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
});

afterEach(fn () => Engines::resetSqlite());

function tableUrl(SavedConnection $c, string $table, string $what): string
{
    return "/api/c/{$c->id}/tables/".rawurlencode($table)."/{$what}";
}

it('returns a sample of rows with column order from the snapshot', function () {
    $response = $this->actingAs($this->user)->getJson(tableUrl($this->connection, 'users', 'sample'))->assertOk();

    expect($response->json('columns'))->toBe(['id', 'group_id', 'name', 'email', 'profile', 'avatar', 'created_at'])
        ->and($response->json('rows'))->toHaveCount(3)
        ->and($response->json('rows.0.2'))->toBe('Ada Lovelace')
        ->and($response->json('limit'))->toBe(50);
});

it('handles reserved-word and unicode table names', function (string $table) {
    $this->actingAs($this->user)->getJson(tableUrl($this->connection, $table, 'sample'))->assertOk();
})->with(['group', 'régions']);

it('samples views', function () {
    $this->actingAs($this->user)->getJson(tableUrl($this->connection, 'order_totals', 'sample'))
        ->assertOk()->assertJsonCount(2, 'rows');
});

it('returns native DDL for SQLite tables and views', function () {
    expect($this->actingAs($this->user)->getJson(tableUrl($this->connection, 'orders', 'ddl'))->json('ddl'))->toContain('CREATE TABLE')
        ->and($this->actingAs($this->user)->getJson(tableUrl($this->connection, 'order_totals', 'ddl'))->json('ddl'))->toContain('CREATE VIEW order_totals');
});

it('404s for tables not in the snapshot', function () {
    $this->actingAs($this->user)->getJson(tableUrl($this->connection, 'sqlite_master', 'sample'))->assertNotFound();
    $this->actingAs($this->user)->getJson(tableUrl($this->connection, 'nope', 'ddl'))->assertNotFound();
});

it('forbids other users', function () {
    $this->actingAs(User::factory()->create())->getJson(tableUrl($this->connection, 'users', 'sample'))->assertForbidden();
});

it('returns a normalized error when the database is gone', function () {
    $this->actingAs($this->user)->getJson(tableUrl($this->connection, 'users', 'sample'))->assertOk(); // snapshot stored
    unlink($this->connection->database);

    $this->actingAs($this->user)->getJson(tableUrl($this->connection, 'users', 'sample'))
        ->assertStatus(422)->assertJsonPath('error.reason', 'sqlite_missing');
});

it('bounds large text and binary values in SQL', function () {
    $db = DB::connectUsing('fixture', ['driver' => 'sqlite', 'database' => $this->connection->database, 'prefix' => '', 'foreign_key_constraints' => true], force: true);
    $db->statement("insert into users (name, email, profile, avatar) values ('Big', 'big@example.test', ?, x'".str_repeat('ab', 3000)."')", [str_repeat('p', 5000)]);
    DB::purge('fixture');

    $response = $this->actingAs($this->user)->getJson(tableUrl($this->connection, 'users', 'sample'))->assertOk();
    $row = collect($response->json('rows'))->firstWhere(2, 'Big');

    expect($row[4])->toBe(str_repeat('p', 200).'…')
        ->and($row[5])->toBe('[binary 3000 bytes]');
});

it('handles table names containing dots', function () {
    $db = DB::connectUsing('fixture', ['driver' => 'sqlite', 'database' => $this->connection->database, 'prefix' => '', 'foreign_key_constraints' => true], force: true);
    $db->statement('create table "my.table" ("a.b" text)');
    $db->statement('insert into "my.table" ("a.b") values (?)', ['x']);
    DB::purge('fixture');

    $this->actingAs($this->user)->postJson("/api/c/{$this->connection->id}/schema/refresh")->assertOk();

    $this->actingAs($this->user)->getJson(tableUrl($this->connection, 'my.table', 'sample'))
        ->assertOk()->assertJsonPath('columns', ['a.b'])->assertJsonPath('rows.0.0', 'x');
    expect($this->actingAs($this->user)->getJson(tableUrl($this->connection, 'my.table', 'ddl'))->assertOk()->json('ddl'))->toContain('my.table');
});
