<?php

use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\Support\Engines;

beforeEach(function () {
    $this->withoutVite();
    $this->user = User::factory()->create();
});
afterEach(fn () => Engines::resetSqlite());

function mysqlPayload(array $overrides = []): array
{
    return array_merge([
        'name' => 'Prod', 'driver' => 'mysql', 'host' => 'db.internal', 'port' => 3306,
        'database' => 'shop', 'username' => 'app', 'password' => 'p@ss', 'options' => ['ssl_ca' => null],
        'read_only' => true, 'color' => '#14b8a6', 'store_history' => true,
    ], $overrides);
}

it('lists only my connections without passwords', function () {
    SavedConnection::factory()->for($this->user)->create(['name' => 'Mine', 'password' => 'top-secret']);
    SavedConnection::factory()->create(['name' => 'Theirs']);

    $response = $this->actingAs($this->user)->get(route('connections.index'));

    $response->assertInertia(fn (Assert $page) => $page
        ->component('connections/index')
        ->has('connections', 1)
        ->where('connections.0.name', 'Mine')
        ->where('connections.0.has_password', true)
        ->missing('connections.0.password'));
    expect($response->getContent())->not->toContain('top-secret');
});

it('creates a connection', function () {
    $this->actingAs($this->user)->post(route('connections.store'), mysqlPayload())
        ->assertRedirect(route('connections.index'));

    $connection = SavedConnection::sole();
    expect($connection->user_id)->toBe($this->user->id)
        ->and($connection->driver)->toBe(DriverName::MySql)
        ->and($connection->password)->toBe('p@ss')
        ->and($connection->read_only)->toBeTrue();
});

it('validates server connections', function () {
    $this->actingAs($this->user)->post(route('connections.store'), mysqlPayload(['host' => '', 'port' => 70000, 'driver' => 'oracle']))
        ->assertSessionHasErrors(['host', 'port', 'driver']);
});

it('rejects SQLite paths outside the allowlist', function () {
    $outside = tempnam(sys_get_temp_dir(), 'dbs');

    $this->actingAs($this->user)->post(route('connections.store'), [
        'name' => 'Local', 'driver' => 'sqlite', 'database' => $outside,
    ])->assertSessionHasErrors('database');
});

it('rejects SQLite paths containing a NUL byte instead of erroring', function () {
    $this->actingAs($this->user)->post(route('connections.store'), [
        'name' => 'Local', 'driver' => 'sqlite', 'database' => Engines::sqlitePath()."\0evil",
    ])->assertSessionHasErrors('database');
});

it('accepts SQLite paths inside the allowlist without host or credentials', function () {
    $this->actingAs($this->user)->post(route('connections.store'), [
        'name' => 'Local', 'driver' => 'sqlite', 'database' => Engines::sqlitePath(),
    ])->assertSessionHasNoErrors();

    expect(SavedConnection::sole()->host)->toBeNull();
});

it('keeps the stored password when the edit form leaves it blank', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['password' => 'original']);

    $this->actingAs($this->user)->put(route('connections.update', $connection), mysqlPayload(['password' => '', 'name' => 'Renamed', 'host' => '127.0.0.1', 'username' => 'root']))
        ->assertRedirect(route('connections.index'));

    expect($connection->fresh()->password)->toBe('original')->and($connection->fresh()->name)->toBe('Renamed');
});

it('clears the stored password only when asked explicitly', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['password' => 'original']);

    $this->actingAs($this->user)->put(route('connections.update', $connection), mysqlPayload(['password' => '', 'clear_password' => true]));

    expect($connection->fresh()->password)->toBeNull();
});

it('renders the edit form without the password', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['password' => 'top-secret']);

    $response = $this->actingAs($this->user)->get(route('connections.edit', $connection))->assertOk();

    expect($response->getContent())->not->toContain('top-secret');
});

it('deletes my connection but not someone else’s', function () {
    $mine = SavedConnection::factory()->for($this->user)->create();
    $theirs = SavedConnection::factory()->create();

    $this->actingAs($this->user)->delete(route('connections.destroy', $mine))->assertRedirect(route('connections.index'));
    $this->actingAs($this->user)->delete(route('connections.destroy', $theirs))->assertForbidden();

    expect(SavedConnection::pluck('id')->all())->toBe([$theirs->id]);
});

it('tests an unsaved SQLite connection', function () {
    $this->actingAs($this->user)->postJson(route('connections.test'), ['name' => 't', 'driver' => 'sqlite', 'database' => Engines::sqlitePath()])
        ->assertOk()
        ->assertJsonPath('ok', true);
});

it('tests an edited connection using the stored password when the field is blank', function () {
    Engines::skipUnlessAvailable('mysql');
    $p = Engines::params('mysql');
    $connection = SavedConnection::factory()->for($this->user)->create([
        'host' => $p['host'], 'port' => $p['port'], 'database' => $p['database'], 'username' => $p['username'], 'password' => $p['password'],
    ]);

    $this->actingAs($this->user)->postJson(route('connections.test'), [
        'connection_id' => $connection->id, 'name' => 'x', 'driver' => 'mysql', 'host' => $p['host'], 'port' => $p['port'],
        'database' => $p['database'], 'username' => $p['username'], 'password' => '',
    ])->assertOk()->assertJsonPath('ok', true);
});

it('refuses to reuse the stored password when testing a different host', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['host' => 'old.internal', 'port' => 3306, 'username' => 'app', 'password' => 'original']);

    $this->actingAs($this->user)->postJson(route('connections.test'), mysqlPayload([
        'connection_id' => $connection->id, 'host' => 'evil.internal', 'password' => '',
    ]))->assertUnprocessable()->assertJsonValidationErrors('password');
});

it('returns 404 when testing with another user\'s connection id', function () {
    $theirs = SavedConnection::factory()->create();

    $this->actingAs($this->user)->postJson(route('connections.test'), mysqlPayload(['connection_id' => $theirs->id, 'password' => '']))
        ->assertNotFound();
});

it('rejects changing the host with a blank password on update', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['host' => 'old.internal', 'port' => 3306, 'username' => 'app', 'password' => 'original']);

    $this->actingAs($this->user)->put(route('connections.update', $connection), mysqlPayload(['host' => 'new.internal', 'password' => '']))
        ->assertSessionHasErrors('password');

    expect($connection->fresh()->password)->toBe('original')->and($connection->fresh()->host)->toBe('old.internal');
});

it('allows changing the host when a new password is supplied', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['host' => 'old.internal', 'port' => 3306, 'username' => 'app', 'password' => 'original']);

    $this->actingAs($this->user)->put(route('connections.update', $connection), mysqlPayload(['host' => 'new.internal', 'password' => 'fresh']))
        ->assertSessionHasNoErrors();

    expect($connection->fresh()->password)->toBe('fresh')->and($connection->fresh()->host)->toBe('new.internal');
});

it('keeps only known option keys', function () {
    $this->actingAs($this->user)->post(route('connections.store'), mysqlPayload(['options' => ['ssl_ca' => '/ca.pem', 'evil' => 'x']]));

    expect(SavedConnection::sole()->options)->toBe(['ssl_ca' => '/ca.pem']);
});

it('allows changing the host of a passwordless connection with a blank password', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['host' => 'old.internal', 'port' => 3306, 'username' => 'app', 'password' => null]);

    $this->actingAs($this->user)->put(route('connections.update', $connection), mysqlPayload(['host' => 'new.internal', 'password' => '']))
        ->assertSessionHasNoErrors();

    expect($connection->fresh()->host)->toBe('new.internal')->and($connection->fresh()->password)->toBeNull();
});
