<?php

use App\Models\QueryHistoryEntry;
use App\Models\SavedConnection;
use App\Models\User;

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->a = SavedConnection::factory()->for($this->user)->create(['name' => 'A', 'password' => null]);
    $this->b = SavedConnection::factory()->for($this->user)->create(['name' => 'B', 'password' => null]);
    $make = fn ($c, $sql, $status = 'ok') => QueryHistoryEntry::create(['connection_id' => $c->id, 'sql' => $sql, 'kind' => 'read', 'status' => $status, 'duration_ms' => 1]);
    foreach (range(1, 60) as $i) {
        $make($this->a, "select {$i} from orders");
    }
    $make($this->a, 'select 100% done', 'error');
    $make($this->b, 'select b_only');
});

it('pages newest first per connection', function () {
    $first = $this->actingAs($this->user)->getJson(route('api.history.index', $this->a))->assertOk();
    expect($first->json('entries'))->toHaveCount(50)->and($first->json('entries.0.sql'))->toBe('select 100% done');

    $second = $this->actingAs($this->user)->getJson(route('api.history.index', [$this->a, 'before_id' => $first->json('next_before_id')]))->assertOk();
    expect($second->json('entries'))->toHaveCount(11)->and($second->json('next_before_id'))->toBeNull();
});

it('filters by text (with LIKE wildcards escaped) and status', function () {
    $this->actingAs($this->user)->getJson(route('api.history.index', [$this->a, 'q' => '100%']))->assertJsonCount(1, 'entries');
    $this->actingAs($this->user)->getJson(route('api.history.index', [$this->a, 'q' => '_']))->assertJsonCount(0, 'entries');
    $this->actingAs($this->user)->getJson(route('api.history.index', [$this->a, 'status' => 'error']))->assertJsonCount(1, 'entries');
});

it('clears one connection', function () {
    $this->actingAs($this->user)->deleteJson(route('api.history.clear', $this->a))->assertOk()->assertJsonPath('cleared', 61);
    expect(QueryHistoryEntry::count())->toBe(1);
});

it('lists across own connections with names and filters by connection', function () {
    $other = SavedConnection::factory()->create();
    QueryHistoryEntry::create(['connection_id' => $other->id, 'sql' => 'select secret', 'kind' => 'read', 'status' => 'ok', 'duration_ms' => 1]);

    $all = $this->actingAs($this->user)->getJson(route('api.history.all', ['q' => 'select']))->assertOk();
    expect(collect($all->json('entries'))->pluck('sql'))->not->toContain('select secret')
        ->and($all->json('entries.0.connection'))->toBe(['id' => $this->b->id, 'name' => 'B']);

    $this->actingAs($this->user)->getJson(route('api.history.all', ['connection_id' => $this->b->id]))->assertJsonCount(1, 'entries');
    $this->actingAs($this->user)->getJson(route('api.history.all', ['connection_id' => $other->id]))->assertJsonCount(0, 'entries');
});

it('forbids other users and renders the page', function () {
    $this->actingAs(User::factory()->create())->getJson(route('api.history.index', $this->a))->assertForbidden();
    $this->withoutVite()->actingAs($this->user)->get(route('history.index'))->assertOk();
});

it('passes the user connections to the history page', function () {
    $this->withoutVite()->actingAs($this->user)->get(route('history.index'))
        ->assertInertia(fn ($page) => $page->component('history/index')->has('connections', 2));
});

it('shows one entry of the connection', function () {
    $entry = QueryHistoryEntry::where('connection_id', $this->b->id)->first();
    $this->actingAs($this->user)->getJson(route('api.history.show', [$this->b, $entry->id]))
        ->assertOk()->assertJsonPath('sql', 'select b_only')->assertJsonPath('id', $entry->id);
});

it('404s an entry that belongs to another connection', function () {
    $entry = QueryHistoryEntry::where('connection_id', $this->b->id)->first();
    $this->actingAs($this->user)->getJson(route('api.history.show', [$this->a, $entry->id]))->assertNotFound();
});

it('forbids showing an entry of another user\'s connection', function () {
    $entry = QueryHistoryEntry::where('connection_id', $this->b->id)->first();
    $this->actingAs(User::factory()->create())->getJson(route('api.history.show', [$this->b, $entry->id]))->assertForbidden();
});
