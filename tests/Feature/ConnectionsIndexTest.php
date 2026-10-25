<?php

use App\Models\LayoutPosition;
use App\Models\PinnedTable;
use App\Models\SavedConnection;
use App\Models\StoredSnapshot;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    $this->withoutVite();
    $this->user = User::factory()->create();
    $this->connection = SavedConnection::factory()->for($this->user)->create(['name' => 'Shop']);
});

function indexSnapshot(SavedConnection $connection, array $nodes = ['orders', 'users', 'products'], array $edges = [[0, 1], [0, 2]]): StoredSnapshot
{
    return StoredSnapshot::create([
        'connection_id' => $connection->id, 'hash' => sha1(uniqid('', true)),
        'payload' => ['tables' => array_map(fn ($n) => ['name' => $n, 'kind' => 'table'], $nodes), 'relationships' => []],
        'table_count' => count($nodes), 'view_count' => 2, 'preview' => ['nodes' => $nodes, 'edges' => $edges],
    ]);
}

function indexLayout(SavedConnection $connection, array $positions): LayoutPosition
{
    return LayoutPosition::create(['connection_id' => $connection->id, 'payload' => array_map(
        fn ($table, $xy) => ['table' => $table, 'x' => $xy[0], 'y' => $xy[1], 'pinned' => false],
        array_keys($positions), $positions,
    )]);
}

it('gives null counts, no star and no pins without a snapshot', function () {
    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->component('connections/index')
            ->where('connections.0.id', $this->connection->id)
            ->where('connections.0.tables', null)
            ->where('connections.0.views', null)
            ->where('connections.0.snapshot_at', null)
            ->where('connections.0.star', null)
            ->where('connections.0.pins', [])
            ->has('connections.0.last_opened_at'));
});

it('gives counts and a star without points when there is no layout', function () {
    $snapshot = indexSnapshot($this->connection);

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('connections.0.tables', 3)
            ->where('connections.0.views', 2)
            ->where('connections.0.snapshot_at', $snapshot->created_at->toIso8601String())
            ->where('connections.0.star.points', null)
            ->where('connections.0.star.edges', [[0, 1], [0, 2]])
            ->where('connections.0.star.count', 3));
});

it('gives no star when the latest snapshot has no preview, so the card seeds its default pattern', function () {
    StoredSnapshot::create(['connection_id' => $this->connection->id, 'hash' => sha1('x'), 'payload' => ['tables' => []]]);

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page->where('connections.0.star', null));
});

it('uses the latest snapshot', function () {
    indexSnapshot($this->connection, ['old']);
    indexSnapshot($this->connection, ['a', 'b'], [[0, 1]]);

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('connections.0.tables', 2)
            ->where('connections.0.star.count', 2));
});

it('normalises layout positions to the unit square and leaves unplaced nodes null', function () {
    indexSnapshot($this->connection, ['orders', 'users', 'products', 'tags']);
    indexLayout($this->connection, ['orders' => [100, -50], 'users' => [300, 150], 'products' => [200, 50], 'elsewhere' => [9999, 9999]]);

    $points = $this->actingAs($this->user)->get(route('connections.index'))->viewData('page')['props']['connections'][0]['star']['points'];

    expect($points)->toHaveCount(4)
        ->and($points[0])->toEqual([0.0, 0.0])
        ->and($points[1])->toEqual([1.0, 1.0])
        ->and($points[2])->toEqual([0.5, 0.5])
        ->and($points[3])->toBeNull();
    foreach (array_merge(...array_filter($points)) as $coordinate) {
        expect($coordinate)->toBeGreaterThanOrEqual(0)->toBeLessThanOrEqual(1);
    }
});

it('centres an axis with no spread', function () {
    indexSnapshot($this->connection, ['a', 'b'], []);
    indexLayout($this->connection, ['a' => [10, 40], 'b' => [10, 80]]);

    $points = $this->actingAs($this->user)->get(route('connections.index'))->viewData('page')['props']['connections'][0]['star']['points'];

    expect($points)->toEqual([[0.5, 0.0], [0.5, 1.0]]);
});

it('lists at most five of my pins in position order', function () {
    foreach (['f' => 5, 'b' => 1, 'd' => 3, 'a' => 0, 'c' => 2, 'e' => 4] as $table => $position) {
        PinnedTable::create(['user_id' => $this->user->id, 'connection_id' => $this->connection->id, 'table_name' => $table, 'position' => $position]);
    }
    PinnedTable::create(['user_id' => User::factory()->create()->id, 'connection_id' => $this->connection->id, 'table_name' => 'theirs', 'position' => 0]);

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page->where('connections.0.pins', ['a', 'b', 'c', 'd', 'e']));
});

it('caches the star map and never reads snapshot or layout payloads once cached', function () {
    indexSnapshot($this->connection);
    indexLayout($this->connection, ['orders' => [0, 0], 'users' => [10, 10]]);
    $this->actingAs($this->user)->get(route('connections.index'))->assertOk();

    $queries = [];
    DB::listen(function ($query) use (&$queries) {
        $queries[] = strtolower($query->sql);
    });
    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page->where('connections.0.star.count', 3));

    $layoutPayloadReads = array_filter($queries, fn ($sql) => str_contains($sql, 'layout_positions')
        && (str_contains($sql, 'payload') || str_contains($sql, '*')));
    $snapshotPayloadReads = array_filter($queries, fn ($sql) => str_contains($sql, 'schema_snapshots')
        && (str_contains($sql, 'payload') || preg_match('/select\s+\*|\.\*/', $sql)));
    expect($layoutPayloadReads)->toBe([])->and($snapshotPayloadReads)->toBe([]);
});

it('recomputes the star map when the layout changes', function () {
    indexSnapshot($this->connection, ['a', 'b'], [[0, 1]]);
    $layout = indexLayout($this->connection, ['a' => [0, 0], 'b' => [10, 10]]);
    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page->where('connections.0.star.points', [[0, 0], [1, 1]]));

    $this->travel(5)->seconds();
    $layout->update(['payload' => [['table' => 'a', 'x' => 10, 'y' => 0, 'pinned' => false], ['table' => 'b', 'x' => 0, 'y' => 10, 'pinned' => false]]]);

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page->where('connections.0.star.points', [[1, 0], [0, 1]]));
});

it('never shows another user\'s connections', function () {
    $other = SavedConnection::factory()->create(['name' => 'Theirs']);
    indexSnapshot($other);

    $this->actingAs($this->user)->get(route('connections.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->has('connections', 1)
            ->where('connections.0.id', $this->connection->id));
});
