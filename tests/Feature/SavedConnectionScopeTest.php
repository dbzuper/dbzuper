<?php

use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\User;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->server = SavedConnection::factory()->for($this->user)->create(['database' => null]);
    $this->fixed = SavedConnection::factory()->for($this->user)->create(['database' => 'app']);
});

function historyRow(SavedConnection $connection): void
{
    $connection->history()->create(['sql' => 'select 1', 'kind' => 'read', 'status' => 'ok', 'duration_ms' => 1]);
}

it('knows which connections are server-level', function () {
    expect($this->server->isServerLevel())->toBeTrue()
        ->and($this->fixed->isServerLevel())->toBeFalse()
        ->and($this->server->forDatabase('a')->isServerLevel())->toBeTrue();

    $sqlite = SavedConnection::factory()->for($this->user)->create(['driver' => DriverName::Sqlite, 'database' => 'x.sqlite', 'host' => null, 'username' => null]);
    expect($sqlite->isServerLevel())->toBeFalse();
});

it('scopes relations to the chosen database', function () {
    $a = $this->server->forDatabase('a');
    $b = $this->server->forDatabase('b');
    historyRow($a);
    historyRow($b);
    historyRow($b);

    expect($a->history()->count())->toBe(1)
        ->and($b->history()->count())->toBe(2)
        ->and($this->server->history()->count())->toBe(0)
        ->and(DB::table('query_history')->where('database', 'a')->count())->toBe(1);
});

it('stores an empty database for fixed connections', function () {
    $this->fixed->pins()->create(['user_id' => $this->user->id, 'table_name' => 'users', 'position' => 1]);

    expect(DB::table('pinned_tables')->value('database'))->toBe('')
        ->and($this->fixed->pins()->count())->toBe(1);
});

it('pins the same table in two databases', function () {
    foreach (['a', 'b'] as $db) {
        $this->server->forDatabase($db)->pins()->create(['user_id' => $this->user->id, 'table_name' => 'users', 'position' => 1]);
    }

    expect(DB::table('pinned_tables')->count())->toBe(2);
});

it('keeps one layout per database', function () {
    $this->server->forDatabase('a')->layout()->updateOrCreate([], ['payload' => [['table' => 'x', 'x' => 1, 'y' => 1, 'pinned' => false]]]);
    $this->server->forDatabase('b')->layout()->updateOrCreate([], ['payload' => []]);
    $this->server->forDatabase('a')->layout()->updateOrCreate([], ['payload' => []]);

    expect(DB::table('layout_positions')->count())->toBe(2)
        ->and($this->server->forDatabase('b')->layout->payload)->toBe([]);
});

it('keeps snapshots per database', function () {
    $this->server->forDatabase('a')->snapshots()->create(['hash' => 'h', 'payload' => ['tables' => []]]);

    expect($this->server->forDatabase('a')->snapshots()->count())->toBe(1)
        ->and($this->server->forDatabase('b')->snapshots()->count())->toBe(0);
});

it('refuses to save a database-scoped clone', function () {
    $scoped = $this->server->forDatabase('a');
    $scoped->name = 'changed';

    expect(fn () => $scoped->save())->toThrow(LogicException::class);
    expect($this->server->fresh()->database)->toBeNull();
});

it('records the last database without changing the saved one', function () {
    $this->server->forDatabase('a')->markOpened();

    $fresh = $this->server->fresh();
    expect($fresh->database)->toBeNull()
        ->and($fresh->last_database)->toBe('a')
        ->and($fresh->last_opened_at)->not->toBeNull();
});

it('does not scope fixed connections', function () {
    expect(fn () => $this->fixed->forDatabase('other'))->toThrow(LogicException::class);
});

it('builds workspace refs', function () {
    expect($this->fixed->workspaceRef())->toBe((string) $this->fixed->id)
        ->and($this->server->workspaceRef())->toBe((string) $this->server->id)
        ->and($this->server->forDatabase('my db')->workspaceRef())->toBe($this->server->id.':my db')
        ->and($this->server->forDatabase('a')->scopedDatabase())->toBe('a')
        ->and($this->server->scopedDatabase())->toBeNull();
});

it('exposes server-level state to the client', function () {
    $this->server->forDatabase('a')->markOpened();

    expect($this->server->fresh()->toClientArray())->toMatchArray(['server_level' => true, 'last_database' => 'a'])
        ->and($this->fixed->toClientArray())->toMatchArray(['server_level' => false]);
});
