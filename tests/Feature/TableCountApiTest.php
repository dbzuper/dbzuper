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
    $db->table('audit_log')->update(['payload' => str_repeat('x', 5000)]);
    DB::purge('fixture');
    $this->connection = SavedConnection::factory()->for($this->user)->create([
        'driver' => DriverName::Sqlite, 'host' => null, 'port' => null, 'database' => $path, 'username' => null, 'password' => null,
    ]);
});

afterEach(fn () => Engines::resetSqlite());

it('counts all rows exactly', function () {
    $this->actingAs($this->user)->postJson(route('api.tables.count', [$this->connection, 'users']), [])
        ->assertOk()->assertExactJson(['count' => 3, 'kind' => 'exact']);
});

it('counts with the same filters as the rows endpoint', function () {
    $this->actingAs($this->user)->postJson(route('api.tables.count', [$this->connection, 'users']), [
        'filters' => [['column' => 'email', 'op' => 'ends_with', 'value' => 'example.com'], ['column' => 'profile', 'op' => 'is_not_null']],
    ])->assertOk()->assertJsonPath('count', 2);
});

it('counts a view', function () {
    $this->actingAs($this->user)->postJson(route('api.tables.count', [$this->connection, 'order_totals']), [])
        ->assertOk()->assertJsonPath('kind', 'exact');
});

it('validates filters and the table', function () {
    $this->actingAs($this->user)->postJson(route('api.tables.count', [$this->connection, 'users']), ['filters' => [['column' => 'nope', 'op' => 'eq', 'value' => '1']]])->assertUnprocessable();
    $this->actingAs($this->user)->postJson(route('api.tables.count', [$this->connection, 'missing']), [])->assertNotFound();
});

it('is limited to the owner', function () {
    $other = User::factory()->create();
    $this->actingAs($other)->postJson(route('api.tables.count', [$this->connection, 'users']), [])->assertForbidden();
});

it('does not shadow the rows route for nested table names', function () {
    expect(route('api.tables.count', [$this->connection, 'a/b']))->toEndWith('/tables/a/b/count');
});
