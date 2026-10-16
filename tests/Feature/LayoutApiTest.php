<?php

use App\Models\SavedConnection;
use App\Models\User;

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->connection = SavedConnection::factory()->for($this->user)->create(['password' => null]);
});

it('returns an empty list before anything is saved', function () {
    $this->actingAs($this->user)->getJson(route('api.layout.show', $this->connection))
        ->assertOk()->assertExactJson(['positions' => []]);
});

it('round-trips positions including awkward table names', function () {
    $positions = [
        ['table' => 'users', 'x' => 1.5, 'y' => -2.25, 'pinned' => true],
        ['table' => 'my.table', 'x' => 0, 'y' => 0, 'pinned' => false],
        ['table' => 'régions', 'x' => 10, 'y' => 20, 'pinned' => false],
        ['table' => 'odd "name"', 'x' => 3, 'y' => 4, 'pinned' => true],
    ];

    $this->actingAs($this->user)->putJson(route('api.layout.update', $this->connection), ['positions' => $positions])
        ->assertOk()->assertExactJson(['saved' => true]);

    $returned = $this->actingAs($this->user)->getJson(route('api.layout.show', $this->connection))->json('positions');
    expect(collect($returned)->sortBy('table')->values()->all())->toEqual(collect($positions)->sortBy('table')->values()->all());
});

it('replaces the previous layout on save', function () {
    $route = route('api.layout.update', $this->connection);
    $this->actingAs($this->user)->putJson($route, ['positions' => [['table' => 'a', 'x' => 1, 'y' => 1, 'pinned' => false]]]);
    $this->actingAs($this->user)->putJson($route, ['positions' => [['table' => 'b', 'x' => 2, 'y' => 2, 'pinned' => false]]]);

    expect($this->actingAs($this->user)->getJson(route('api.layout.show', $this->connection))->json('positions.*.table'))->toBe(['b']);
});

it('validates entries', function (array $entry, string $errorKey) {
    $this->actingAs($this->user)->putJson(route('api.layout.update', $this->connection), ['positions' => [$entry]])
        ->assertUnprocessable()->assertJsonValidationErrors($errorKey);
})->with([
    'non-numeric x' => [['table' => 'a', 'x' => 'left', 'y' => 0, 'pinned' => false], 'positions.0.x'],
    'missing pinned' => [['table' => 'a', 'x' => 0, 'y' => 0], 'positions.0.pinned'],
    'empty table' => [['table' => '', 'x' => 0, 'y' => 0, 'pinned' => false], 'positions.0.table'],
    'huge coordinate' => [['table' => 'a', 'x' => 1e9, 'y' => 0, 'pinned' => false], 'positions.0.x'],
]);

it('rejects more than 10000 entries', function () {
    $positions = array_map(fn ($i) => ['table' => "t{$i}", 'x' => 0, 'y' => 0, 'pinned' => false], range(0, 10000));

    $this->actingAs($this->user)->putJson(route('api.layout.update', $this->connection), ['positions' => $positions])
        ->assertUnprocessable()->assertJsonValidationErrors('positions');
});

it('accepts a layout for every object when the schema cap is above 10000', function () {
    config(['dbsuperb.schema_max_objects' => 10001]);
    $positions = array_map(fn ($i) => ['table' => "t{$i}", 'x' => 0, 'y' => 0, 'pinned' => false], range(0, 10000));

    $this->actingAs($this->user)->putJson(route('api.layout.update', $this->connection), ['positions' => $positions])
        ->assertOk();
});

it('forbids other users', function () {
    $other = User::factory()->create();

    $this->actingAs($other)->getJson(route('api.layout.show', $this->connection))->assertForbidden();
    $this->actingAs($other)->putJson(route('api.layout.update', $this->connection), ['positions' => []])->assertForbidden();
});

it('clears the layout when the connection is repointed to another database', function () {
    $this->actingAs($this->user)->putJson(route('api.layout.update', $this->connection), [
        'positions' => [['table' => 'a', 'x' => 1, 'y' => 1, 'pinned' => true]],
    ]);

    $this->actingAs($this->user)->put(route('connections.update', $this->connection), [
        'name' => $this->connection->name, 'driver' => 'mysql', 'host' => $this->connection->host,
        'port' => $this->connection->port, 'database' => 'another_db', 'username' => $this->connection->username,
    ])->assertSessionHasNoErrors();

    expect($this->connection->fresh()->layout)->toBeNull();
});

it('merges a partial save into the stored positions when merge is set', function () {
    $route = route('api.layout.update', $this->connection);
    $this->actingAs($this->user)->putJson($route, ['positions' => [
        ['table' => 'a', 'x' => 1, 'y' => 1, 'pinned' => false],
        ['table' => 'b', 'x' => 2, 'y' => 2, 'pinned' => false],
    ]])->assertOk();

    $this->actingAs($this->user)->putJson($route, ['merge' => true, 'positions' => [
        ['table' => 'b', 'x' => 20, 'y' => 20, 'pinned' => true],
        ['table' => 'c', 'x' => 3, 'y' => 3, 'pinned' => false],
    ]])->assertOk()->assertExactJson(['saved' => true]);

    $stored = collect($this->actingAs($this->user)->getJson(route('api.layout.show', $this->connection))->json('positions'))->keyBy('table');
    expect($stored->keys()->sort()->values()->all())->toBe(['a', 'b', 'c'])
        ->and($stored['a']['x'])->toEqual(1)
        ->and($stored['b'])->toEqual(['table' => 'b', 'x' => 20, 'y' => 20, 'pinned' => true]);
});

it('merges into an empty layout', function () {
    $this->actingAs($this->user)->putJson(route('api.layout.update', $this->connection), ['merge' => true, 'positions' => [['table' => 'a', 'x' => 1, 'y' => 1, 'pinned' => false]]])->assertOk();

    expect($this->actingAs($this->user)->getJson(route('api.layout.show', $this->connection))->json('positions.*.table'))->toBe(['a']);
});

it('rejects a merge that would grow the layout past the entry cap', function () {
    $route = route('api.layout.update', $this->connection);
    $batch = fn (string $prefix) => array_map(fn ($i) => ['table' => "{$prefix}{$i}", 'x' => 0, 'y' => 0, 'pinned' => false], range(1, 6000));

    $this->actingAs($this->user)->putJson($route, ['positions' => $batch('a')])->assertOk();
    $this->actingAs($this->user)->putJson($route, ['merge' => true, 'positions' => $batch('b')])
        ->assertUnprocessable()->assertJsonValidationErrors('positions');
    expect($this->actingAs($this->user)->getJson(route('api.layout.show', $this->connection))->json('positions'))->toHaveCount(6000);
});
