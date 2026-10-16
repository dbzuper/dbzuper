<?php

use App\Models\PinnedTable;
use App\Models\SavedConnection;
use App\Models\User;

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->connection = SavedConnection::factory()->for($this->user)->create();
    $this->pin = fn (string $table) => $this->actingAs($this->user)->postJson(route('api.pins.store', $this->connection), ['table' => $table]);
});

it('pins tables in order and lists them', function () {
    ($this->pin)('users')->assertCreated()->assertJsonPath('pin.table', 'users');
    ($this->pin)('order items')->assertCreated();
    ($this->pin)('数据/a.b')->assertCreated();

    $this->actingAs($this->user)->getJson(route('api.pins.index', $this->connection))
        ->assertOk()->assertJsonPath('pins.*.table', ['users', 'order items', '数据/a.b']);
});

it('is idempotent', function () {
    $id = ($this->pin)('users')->json('pin.id');
    ($this->pin)('users')->assertOk()->assertJsonPath('pin.id', $id);
    expect($this->connection->pins()->count())->toBe(1);
});

it('reorders only with this user\'s pins of this connection', function () {
    $a = ($this->pin)('a')->json('pin.id');
    $b = ($this->pin)('b')->json('pin.id');
    $this->actingAs($this->user)->putJson(route('api.pins.order', $this->connection), ['ids' => [$b, $a]])
        ->assertOk()->assertJsonPath('pins.*.table', ['b', 'a']);

    $otherConnection = SavedConnection::factory()->for($this->user)->create();
    $foreign = $this->actingAs($this->user)->postJson(route('api.pins.store', $otherConnection), ['table' => 'x'])->json('pin.id');
    $this->actingAs($this->user)->putJson(route('api.pins.order', $this->connection), ['ids' => [$b, $a, $foreign]])->assertUnprocessable();
    $this->actingAs($this->user)->putJson(route('api.pins.order', $this->connection), ['ids' => [$b]])->assertUnprocessable();
});

it('deletes only its own pin', function () {
    $id = ($this->pin)('users')->json('pin.id');
    $otherConnection = SavedConnection::factory()->for($this->user)->create();
    $this->actingAs($this->user)->deleteJson(route('api.pins.destroy', [$otherConnection, $id]))->assertNotFound();
    $this->actingAs($this->user)->deleteJson(route('api.pins.destroy', [$this->connection, $id]))->assertNoContent();
    expect($this->connection->pins()->count())->toBe(0);
});

it('forbids other users', function () {
    $other = User::factory()->create();
    $this->actingAs($other)->getJson(route('api.pins.index', $this->connection))->assertForbidden();
    $this->actingAs($other)->postJson(route('api.pins.store', $this->connection), ['table' => 'users'])->assertForbidden();
});

it('validates the table name and caps pins at 200', function () {
    ($this->pin)('')->assertUnprocessable();
    ($this->pin)(str_repeat('x', 256))->assertUnprocessable();
    foreach (range(1, 200) as $i) {
        $this->connection->pins()->create(['user_id' => $this->user->id, 'table_name' => "t{$i}", 'position' => $i]);
    }
    ($this->pin)('one_more')->assertUnprocessable();
});

it('goes away with its connection', function () {
    ($this->pin)('users');
    $this->connection->delete();
    expect(PinnedTable::count())->toBe(0);
});

it('returns the existing pin when a concurrent request inserts the same table first', function () {
    $racer = null;
    PinnedTable::creating(function (PinnedTable $pin) use (&$racer) {
        // Simulate another request winning the race after this request's existence check missed.
        $racer ??= DB::table('pinned_tables')->insertGetId([
            'user_id' => $pin->user_id,
            'connection_id' => $pin->connection_id,
            'table_name' => $pin->table_name,
            'position' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    });

    $this->actingAs($this->user)->postJson(route('api.pins.store', $this->connection), ['table' => 'users'])
        ->assertOk()->assertJsonPath('pin.id', $racer)->assertJsonPath('pin.table', 'users');
    expect($this->connection->pins()->count())->toBe(1);
});
