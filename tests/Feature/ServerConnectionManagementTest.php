<?php

use App\Models\SavedConnection;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    $this->withoutVite();
    $this->user = User::factory()->create();
});

function serverPayload(array $overrides = []): array
{
    return array_merge([
        'name' => 'Local', 'driver' => 'mysql', 'host' => 'localhost', 'port' => 3306,
        'database' => '', 'username' => 'root', 'password' => 'p@ss', 'read_only' => false, 'store_history' => true,
    ], $overrides);
}

function seedScopedRows(SavedConnection $connection): void
{
    $connection->snapshots()->create(['hash' => 'h', 'payload' => ['tables' => []]]);
    $connection->layout()->updateOrCreate([], ['payload' => []]);
    $connection->pins()->create(['user_id' => $connection->user_id, 'table_name' => 'users', 'position' => 1]);
    $connection->history()->create(['sql' => 'select 1', 'kind' => 'read', 'status' => 'ok', 'duration_ms' => 1]);
}

it('saves server connections without a database', function (string $driver) {
    $this->actingAs($this->user)->post(route('connections.store'), serverPayload(['driver' => $driver, 'port' => $driver === 'pgsql' ? 5432 : 3306]))
        ->assertSessionHasNoErrors();

    expect(SavedConnection::sole()->database)->toBeNull();
})->with(['mysql', 'mariadb', 'pgsql']);

it('still requires a path for SQLite', function () {
    $this->actingAs($this->user)->post(route('connections.store'), serverPayload(['driver' => 'sqlite', 'host' => null, 'username' => null]))
        ->assertSessionHasErrors('database');
});

it('moves a fixed connection\'s data under its database when it becomes server-level', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['database' => 'app', 'password' => null]);
    seedScopedRows($connection);

    $this->actingAs($this->user)->put(route('connections.update', $connection), serverPayload(['host' => '127.0.0.1', 'password' => null]))
        ->assertSessionHasNoErrors();

    $scoped = $connection->fresh()->forDatabase('app');
    expect($scoped->snapshots()->count())->toBe(1)
        ->and($scoped->layout()->count())->toBe(1)
        ->and($scoped->pins()->count())->toBe(1)
        ->and($scoped->history()->count())->toBe(1)
        ->and(DB::table('pinned_tables')->where('database', '')->count())->toBe(0);
});

it('drops per-database data when a server-level connection gets a fixed database', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['database' => null, 'password' => null]);
    seedScopedRows($connection->forDatabase('a'));

    $this->actingAs($this->user)->put(route('connections.update', $connection), serverPayload(['database' => 'app', 'password' => null]))
        ->assertSessionHasNoErrors();

    foreach (['schema_snapshots', 'layout_positions', 'pinned_tables', 'query_history'] as $table) {
        expect(DB::table($table)->count())->toBe(0);
    }
});

it('drops saved data instead of moving it when the server changes too', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['database' => 'app', 'password' => null]);
    seedScopedRows($connection);

    $this->actingAs($this->user)->put(route('connections.update', $connection), serverPayload(['host' => 'elsewhere', 'password' => null]))
        ->assertSessionHasNoErrors();

    expect(DB::table('schema_snapshots')->count())->toBe(0)
        ->and(DB::table('layout_positions')->count())->toBe(0);
});

it('asks for the password again when the database changes', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['database' => 'app', 'password' => 'secret']);

    $this->actingAs($this->user)->put(route('connections.update', $connection), serverPayload(['password' => null]))
        ->assertSessionHasErrors('password');
});

it('labels server-level cards and leaves out their pins', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['database' => null]);
    seedScopedRows($connection->forDatabase('a'));

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('connections.0.database_label', 'All databases')
            ->where('connections.0.pins', [])
            ->where('connections.0.server_level', true));
});

it('labels fixed cards with their database', function () {
    SavedConnection::factory()->for($this->user)->create(['database' => 'shop']);

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page->where('connections.0.database_label', 'shop'));
});

it('lists and shows history per database', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['database' => null]);
    seedScopedRows($connection->forDatabase('a'));
    $entry = DB::table('query_history')->value('id');

    $this->actingAs($this->user)->getJson('/api/c/'.$connection->id.':a/history')->assertOk()->assertJsonCount(1, 'entries');
    $this->actingAs($this->user)->getJson('/api/c/'.$connection->id.':b/history')->assertOk()->assertJsonCount(0, 'entries');
    $this->actingAs($this->user)->getJson('/api/c/'.$connection->id.':b/history/'.$entry)->assertNotFound();
    $this->actingAs($this->user)->getJson('/api/c/'.$connection->id.':a/history/'.$entry)->assertOk();
});

it('tells global history and the sidebar which database an entry ran on', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['database' => null]);
    seedScopedRows($connection->forDatabase('a'));
    $fixed = SavedConnection::factory()->for($this->user)->create(['database' => 'shop']);
    $fixed->history()->create(['sql' => 'select 2', 'kind' => 'read', 'status' => 'ok', 'duration_ms' => 1]);

    $this->actingAs($this->user)->getJson(route('api.history.all'))->assertOk()
        ->assertJsonPath('entries.0.database', null)
        ->assertJsonPath('entries.0.workspace_ref', (string) $fixed->id)
        ->assertJsonPath('entries.1.database', 'a')
        ->assertJsonPath('entries.1.workspace_ref', $connection->id.':a');

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('sidebar.recentQueries.1.database', 'a')
            ->where('sidebar.recentQueries.1.workspace_ref', $connection->id.':a'));
});
