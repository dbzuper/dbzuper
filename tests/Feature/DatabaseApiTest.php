<?php

use App\Database\DatabaseEntry;
use App\Database\DatabaseLister;
use App\Models\SavedConnection;
use App\Models\User;

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->server = SavedConnection::factory()->for($this->user)->create(['database' => null]);
    $this->server->forceFill(['last_database' => 'shop'])->save();
    $this->mock(DatabaseLister::class)->shouldReceive('list')->andReturn([
        new DatabaseEntry('mysql', true, 30, 1024, true),
        new DatabaseEntry('shop', false, 12, 4096, true),
    ]);
});

it('lists the databases of a server-level connection', function () {
    $this->actingAs($this->user)->getJson('/api/c/'.$this->server->id.'/databases')->assertOk()
        ->assertExactJson([
            'databases' => [
                ['name' => 'mysql', 'system' => true, 'tables' => 30, 'bytes' => 1024, 'openable' => true],
                ['name' => 'shop', 'system' => false, 'tables' => 12, 'bytes' => 4096, 'openable' => true],
            ],
            'last_database' => 'shop',
        ]);
});

it('has no database list for fixed connections or scoped refs', function () {
    $fixed = SavedConnection::factory()->for($this->user)->create(['database' => 'app']);

    $this->actingAs($this->user)->getJson('/api/c/'.$fixed->id.'/databases')->assertNotFound();
    $this->actingAs($this->user)->getJson('/api/c/'.$this->server->id.':shop/databases')->assertNotFound();
});

it('forbids other users', function () {
    $this->actingAs(User::factory()->create())->getJson('/api/c/'.$this->server->id.'/databases')->assertForbidden();
});
