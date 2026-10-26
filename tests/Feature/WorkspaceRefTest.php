<?php

use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function () {
    $this->withoutVite();
    $this->user = User::factory()->create();
    $this->server = SavedConnection::factory()->for($this->user)->create(['database' => null]);
    $this->fixed = SavedConnection::factory()->for($this->user)->create(['database' => 'app']);
    $this->pins = fn (string $ref) => '/api/c/'.$ref.'/pins';
});

it('scopes API calls to the database named in the ref', function () {
    $this->actingAs($this->user)->postJson(($this->pins)($this->server->id.':a'), ['table' => 'users'])->assertCreated();

    $this->actingAs($this->user)->getJson(($this->pins)($this->server->id.':a'))->assertOk()->assertJsonPath('pins.*.table', ['users']);
    $this->actingAs($this->user)->getJson(($this->pins)($this->server->id.':b'))->assertOk()->assertJsonPath('pins', []);
});

it('requires a database for server-level API calls', function () {
    $this->actingAs($this->user)->getJson(($this->pins)((string) $this->server->id))->assertNotFound();
});

it('keeps fixed connections on their own database', function () {
    $this->actingAs($this->user)->getJson(($this->pins)($this->fixed->id.':other'))->assertNotFound();
    $this->actingAs($this->user)->getJson(($this->pins)($this->fixed->id.':app'))->assertOk();
    $this->actingAs($this->user)->getJson(($this->pins)((string) $this->fixed->id))->assertOk();
});

it('round-trips database names with spaces, dashes and unicode', function () {
    $name = 'shop-staging my données';
    $this->actingAs($this->user)->postJson(($this->pins)($this->server->id.':'.rawurlencode($name)), ['table' => 'users'])->assertCreated();

    expect(DB::table('pinned_tables')->value('database'))->toBe($name);
});

it('rejects database names that are unsafe in a DSN', function () {
    $pg = SavedConnection::factory()->for($this->user)->create(['driver' => DriverName::Postgres, 'port' => 5432, 'database' => null]);

    $this->actingAs($this->user)->getJson(($this->pins)($pg->id.':'.rawurlencode("bad'name")))->assertNotFound();
    $this->actingAs($this->user)->getJson(($this->pins)($pg->id.':'.rawurlencode('two words')))->assertNotFound();
    $this->actingAs($this->user)->getJson(($this->pins)($this->server->id.':'.rawurlencode('a;b')))->assertNotFound();
    $this->actingAs($this->user)->getJson(($this->pins)($this->server->id.':'))->assertNotFound();
    $this->actingAs($this->user)->getJson(($this->pins)('abc'))->assertNotFound();
});

it('forbids other users scoped refs', function () {
    $this->actingAs(User::factory()->create())->getJson(($this->pins)($this->server->id.':a'))->assertForbidden();
});

it('shows the database list for a server-level connection', function () {
    $this->actingAs($this->user)->get('/c/'.$this->server->id)
        ->assertInertia(fn (Assert $page) => $page->component('connections/databases')->where('connection.id', $this->server->id));
});

it('opens one database of a server-level connection', function () {
    $this->actingAs($this->user)->get('/c/'.$this->server->id.'/'.rawurlencode('my db'))
        ->assertInertia(fn (Assert $page) => $page->component('workspace/show')
            ->where('connection.ref', $this->server->id.':my db')
            ->where('connection.database', 'my db')
            ->where('connection.server_level', true));

    $fresh = $this->server->fresh();
    expect($fresh->database)->toBeNull()->and($fresh->last_database)->toBe('my db');
});

it('opens fixed connections as before', function () {
    $this->actingAs($this->user)->get('/c/'.$this->fixed->id)
        ->assertInertia(fn (Assert $page) => $page->component('workspace/show')
            ->where('connection.ref', (string) $this->fixed->id)
            ->where('connection.database', 'app'));
    $this->actingAs($this->user)->get('/c/'.$this->fixed->id.'/other')->assertNotFound();
    $this->actingAs($this->user)->get('/c/'.$this->fixed->id.'/app')->assertRedirect('/c/'.$this->fixed->id);
});

it('rejects unsafe database names in the workspace URL', function () {
    $this->actingAs($this->user)->get('/c/'.$this->server->id.'/'.rawurlencode('a;b'))->assertNotFound();
});

it('forbids other users from the database list', function () {
    $this->actingAs(User::factory()->create())->get('/c/'.$this->server->id)->assertForbidden();
});

it('only accepts plain ids where a saved connection is managed or opened', function () {
    $ref = $this->server->id.':a';
    $this->actingAs($this->user)->get('/connections/'.$ref.'/edit')->assertNotFound();
    $this->actingAs($this->user)->put('/connections/'.$ref, ['name' => 'x'])->assertNotFound();
    $this->actingAs($this->user)->delete('/connections/'.$ref)->assertNotFound();
    $this->actingAs($this->user)->get('/c/'.$ref)->assertNotFound();
    expect($this->server->fresh())->not->toBeNull();
});
