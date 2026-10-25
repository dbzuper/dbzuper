<?php

use App\Models\QueryHistoryEntry;
use App\Models\SavedConnection;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    $this->withoutVite();
    $this->user = User::factory()->create();
});

function sidebarEntry(SavedConnection $connection, string $sql, string $at): QueryHistoryEntry
{
    $entry = QueryHistoryEntry::create([
        'connection_id' => $connection->id, 'sql' => $sql, 'kind' => 'select', 'status' => 'ok',
        'duration_ms' => 1, 'row_count' => 1, 'affected' => null, 'error' => null,
    ]);
    $entry->forceFill(['created_at' => $at])->save();

    return $entry;
}

it('shares a null sidebar with guests', function () {
    $this->get(route('login'))->assertInertia(fn (Assert $page) => $page->where('sidebar', null));
});

it('lists up to four opened connections, newest first, skipping never-opened ones', function () {
    foreach (range(1, 5) as $i) {
        SavedConnection::factory()->for($this->user)->create(['name' => "C$i", 'last_opened_at' => now()->subMinutes(10 - $i)]);
    }
    SavedConnection::factory()->for($this->user)->create(['name' => 'Never', 'last_opened_at' => null]);

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->has('sidebar.recentConnections', 4)
            ->where('sidebar.recentConnections.0.name', 'C5')->where('sidebar.recentConnections.3.name', 'C2')
            ->has('sidebar.recentConnections.0', fn (Assert $c) => $c->hasAll(['id', 'name', 'color', 'driver_label'])->where('driver_label', 'MySQL')));
});

it('orders recent queries by id, which rises with inserts, so no created_at index is needed', function () {
    $connection = SavedConnection::factory()->for($this->user)->create();
    sidebarEntry($connection, 'SELECT first', '2026-01-01 12:00:00');
    sidebarEntry($connection, 'SELECT second', '2026-01-01 11:00:00');

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page->where('sidebar.recentQueries.0.sql', 'SELECT second'));
});

it('lists the three newest queries with only the first non-empty line, cut to 120 characters', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['name' => 'Shop', 'color' => '#ff0000']);
    sidebarEntry($connection, "\n  \n  SELECT 1  \nFROM x", '2026-01-01 10:00:00');
    sidebarEntry($connection, 'SELECT '.str_repeat('a', 200), '2026-01-01 11:00:00');
    sidebarEntry($connection, 'SELECT 3', '2026-01-01 12:00:00');
    sidebarEntry($connection, 'SELECT 4', '2026-01-01 13:00:00');

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->has('sidebar.recentQueries', 3)
            ->where('sidebar.recentQueries.0.sql', 'SELECT 4')
            ->where('sidebar.recentQueries.1.sql', 'SELECT 3')
            ->where('sidebar.recentQueries.2.sql', mb_substr('SELECT '.str_repeat('a', 200), 0, 120))
            ->where('sidebar.recentQueries.0.connection_name', 'Shop')
            ->where('sidebar.recentQueries.0.color', '#ff0000')
            ->where('sidebar.recentQueries.0.connection_id', $connection->id)
            ->has('sidebar.recentQueries.0.created_at'));

    $trimmed = sidebarEntry($connection, "\n  SELECT 1  \nFROM x", '2026-01-01 14:00:00');
    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page->where('sidebar.recentQueries.0.sql', 'SELECT 1'));
});

it("never shows another user's history", function () {
    $other = SavedConnection::factory()->for(User::factory())->create();
    sidebarEntry($other, 'SELECT secret', '2026-01-01 10:00:00');

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page->where('sidebar.recentQueries', []));
});

it('drops history entries when their connection is deleted', function () {
    $connection = SavedConnection::factory()->for($this->user)->create();
    sidebarEntry($connection, 'SELECT 1', '2026-01-01 10:00:00');
    $connection->delete();

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page->where('sidebar.recentQueries', []));
});
