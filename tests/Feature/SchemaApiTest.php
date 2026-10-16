<?php

use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\StoredSnapshot;
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

it('returns a snapshot, creating it on first request and reusing it after', function () {
    $response = $this->actingAs($this->user)->getJson(route('api.schema.show', $this->connection))->assertOk();

    expect($response->json('snapshot.tables'))->not->toBeEmpty()
        ->and(collect($response->json('snapshot.tables'))->pluck('name'))->toContain('users')
        ->and($response->json('snapshot.hash'))->toHaveLength(40);

    $this->actingAs($this->user)->getJson(route('api.schema.show', $this->connection))->assertOk();
    expect(StoredSnapshot::count())->toBe(1);
});

it('stores a new snapshot on refresh and prunes old ones', function () {
    config(['dbsuperb.snapshot_keep' => 2]);

    foreach (range(1, 3) as $_) {
        $this->actingAs($this->user)->postJson(route('api.schema.refresh', $this->connection))->assertOk();
    }

    expect(StoredSnapshot::where('connection_id', $this->connection->id)->count())->toBe(2);
});

it('returns a normalized error when the database is unreachable', function () {
    $this->connection->update(['database' => Engines::sqliteDirectory().'/gone.sqlite']);

    $this->actingAs($this->user)->getJson(route('api.schema.show', $this->connection))
        ->assertStatus(422)
        ->assertJsonPath('error.kind', 'not_found')
        ->assertJsonPath('error.reason', 'sqlite_missing')
        ->assertJsonMissingPath('exception');
});

it('forbids other users and guests', function () {
    $this->actingAs(User::factory()->create())->getJson(route('api.schema.show', $this->connection))->assertForbidden();
    auth()->logout();
    $this->getJson(route('api.schema.show', $this->connection))->assertUnauthorized();
});

it('introspects SQLite tables, views and indexes whose names contain a quote', function () {
    $pdo = new PDO('sqlite:'.$this->connection->database);
    $pdo->exec('create table "o\'clock" (id integer primary key, "it\'s" text, owner_id integer references users(id))');
    $pdo->exec('create index "o\'clock idx" on "o\'clock" ("it\'s")');
    $pdo->exec('create view "v\'iew" as select id from "o\'clock"');
    unset($pdo);

    $response = $this->actingAs($this->user)->getJson(route('api.schema.show', $this->connection))->assertOk();

    $table = collect($response->json('snapshot.tables'))->firstWhere('name', "o'clock");
    expect($table)->not->toBeNull()
        ->and(collect($table['columns'])->pluck('name')->all())->toBe(['id', "it's", 'owner_id'])
        ->and(collect($table['indexes'])->pluck('name')->all())->toContain("o'clock idx")
        ->and(collect($response->json('snapshot.tables'))->pluck('name'))->toContain("v'iew");
});
