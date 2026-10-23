<?php

use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\StoredSnapshot;
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

    $this->actingAs($this->user)->put(route('connections.update', $connection), mysqlPayload(['password' => '', 'name' => 'Renamed', 'host' => '127.0.0.1', 'username' => 'root', 'database' => 'app']))
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

function pgPayload(array $overrides = []): array
{
    return array_replace_recursive([
        'name' => 'Pg', 'driver' => 'pgsql', 'host' => 'db.internal', 'port' => 5432,
        'database' => 'shop', 'username' => 'app', 'password' => 'p@ss',
        'options' => ['sslmode' => 'prefer', 'schema' => 'public', 'ssl_ca' => null],
        'read_only' => false, 'color' => '#14b8a6', 'store_history' => true,
    ], $overrides);
}

it('rejects libpq keyword injection as validation errors on store', function () {
    $this->actingAs($this->user)->post(route('connections.store'), pgPayload([
        'database' => "shop' hostaddr='203.0.113.9",
        'options' => ['ssl_ca' => '/tmp/ca.pem hostaddr=203.0.113.10'],
    ]))->assertSessionHasErrors(['database', 'options.ssl_ca']);

    expect(SavedConnection::count())->toBe(0);
});

it('rejects libpq keyword injection as JSON validation errors on the test endpoint', function () {
    $this->actingAs($this->user)->postJson(route('connections.test'), pgPayload([
        'host' => 'db.internal hostaddr=203.0.113.9',
        'database' => "shop' hostaddr='203.0.113.9",
        'username' => 'app\\',
        'options' => ['ssl_ca' => '/tmp/ca.pem hostaddr=203.0.113.10'],
    ]))->assertUnprocessable()->assertJsonValidationErrors(['host', 'database', 'username', 'options.ssl_ca']);
});

it('rejects DSN separators in MySQL fields as validation errors', function () {
    $this->actingAs($this->user)->postJson(route('connections.test'), mysqlPayload(['database' => 'shop;host=203.0.113.9']))
        ->assertUnprocessable()->assertJsonValidationErrors(['database']);
});

it('requires the password again when any DSN field changes on update', function (array $change) {
    $connection = SavedConnection::factory()->for($this->user)->create([
        'driver' => DriverName::Postgres, 'host' => 'db.internal', 'port' => 5432, 'database' => 'shop', 'username' => 'app',
        'password' => 'original', 'options' => ['sslmode' => 'prefer', 'schema' => 'public'],
    ]);

    $this->actingAs($this->user)->put(route('connections.update', $connection), pgPayload(['password' => '', ...$change]))
        ->assertSessionHasErrors('password');

    expect($connection->fresh()->database)->toBe('shop')->and($connection->fresh()->password)->toBe('original');
})->with([
    'database' => [['database' => 'other']],
    'ssl_ca' => [['options' => ['sslmode' => 'prefer', 'schema' => 'public', 'ssl_ca' => '/tmp/ca.pem']]],
    'sslmode' => [['options' => ['sslmode' => 'disable', 'schema' => 'public']]],
    'schema' => [['options' => ['sslmode' => 'prefer', 'schema' => 'sales']]],
]);

it('requires the password again when only the database changes on the test endpoint', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['host' => 'db.internal', 'port' => 3306, 'database' => 'shop', 'username' => 'app', 'password' => 'original']);

    $this->actingAs($this->user)->postJson(route('connections.test'), mysqlPayload([
        'connection_id' => $connection->id, 'database' => 'attacker_db', 'password' => '',
    ]))->assertUnprocessable()->assertJsonValidationErrors('password');
});

it('requires the password again when the ssl_verify flag changes', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['host' => 'db.internal', 'port' => 3306, 'database' => 'shop', 'username' => 'app', 'password' => 'original', 'options' => ['ssl_ca' => '/ca.pem']]);

    $this->actingAs($this->user)->put(route('connections.update', $connection), mysqlPayload([
        'password' => '', 'options' => ['ssl_ca' => '/ca.pem', 'ssl_verify' => false],
    ]))->assertSessionHasErrors('password');
});

it('keeps the stored password when unchanged PostgreSQL defaults are resubmitted', function () {
    $connection = SavedConnection::factory()->for($this->user)->create([
        'driver' => DriverName::Postgres, 'host' => 'db.internal', 'port' => 5432, 'database' => 'shop', 'username' => 'app',
        'password' => 'original', 'options' => [],
    ]);

    $this->actingAs($this->user)->put(route('connections.update', $connection), pgPayload(['password' => '', 'name' => 'Renamed']))
        ->assertSessionHasNoErrors();

    expect($connection->fresh()->password)->toBe('original')->and($connection->fresh()->name)->toBe('Renamed');
});

it('drops stored snapshots when the connection points somewhere else', function (array $change) {
    $connection = SavedConnection::factory()->for($this->user)->create(['host' => 'db.internal', 'port' => 3306, 'database' => 'shop', 'username' => 'app', 'password' => null]);
    StoredSnapshot::create(['connection_id' => $connection->id, 'hash' => str_repeat('a', 40), 'payload' => []]);

    $this->actingAs($this->user)->put(route('connections.update', $connection), mysqlPayload(['password' => '', ...$change]))
        ->assertSessionHasNoErrors();

    expect($connection->snapshots()->count())->toBe(0);
})->with([
    'database' => [['database' => 'other']],
    'host' => [['host' => 'db2.internal']],
    'port' => [['port' => 3307]],
    'driver' => [['driver' => 'mariadb']],
]);

it('drops stored snapshots when the PostgreSQL schema changes', function () {
    $connection = SavedConnection::factory()->for($this->user)->create([
        'driver' => DriverName::Postgres, 'host' => 'db.internal', 'port' => 5432, 'database' => 'shop', 'username' => 'app',
        'password' => null, 'options' => ['schema' => 'public'],
    ]);
    StoredSnapshot::create(['connection_id' => $connection->id, 'hash' => str_repeat('a', 40), 'payload' => []]);

    $this->actingAs($this->user)->put(route('connections.update', $connection), pgPayload(['password' => '', 'options' => ['schema' => 'sales']]))
        ->assertSessionHasNoErrors();

    expect($connection->snapshots()->count())->toBe(0);
});

it('keeps stored snapshots when only cosmetic settings change', function () {
    $connection = SavedConnection::factory()->for($this->user)->create(['host' => 'db.internal', 'port' => 3306, 'database' => 'shop', 'username' => 'app', 'password' => null]);
    StoredSnapshot::create(['connection_id' => $connection->id, 'hash' => str_repeat('a', 40), 'payload' => []]);

    $this->actingAs($this->user)->put(route('connections.update', $connection), mysqlPayload(['password' => '', 'name' => 'Renamed', 'color' => '#000000']))
        ->assertSessionHasNoErrors();

    expect($connection->snapshots()->count())->toBe(1);
});

it('stores the MySQL SSL mode and drops the CA path and ssl_verify it makes irrelevant', function (string $driver, array $options, array $stored) {
    $this->actingAs($this->user)->post(route('connections.store'), mysqlPayload(['driver' => $driver, 'options' => $options]))
        ->assertSessionHasNoErrors();

    $options = SavedConnection::sole()->options;
    ksort($options);
    ksort($stored);
    expect($options)->toBe($stored);
})->with(['mysql', 'mariadb'])->with([
    'disabled' => [['mysql_ssl' => 'disabled', 'ssl_ca' => '/ca.pem', 'ssl_verify' => true], ['mysql_ssl' => 'disabled']],
    'required' => [['mysql_ssl' => 'required', 'ssl_ca' => '/ca.pem'], ['mysql_ssl' => 'required']],
    'verify identity' => [['mysql_ssl' => 'verify_identity', 'ssl_ca' => '/ca.pem', 'ssl_verify' => false], ['ssl_ca' => '/ca.pem', 'mysql_ssl' => 'verify_identity']],
]);

it('does not store a MySQL SSL mode on a PostgreSQL connection', function () {
    $this->actingAs($this->user)->post(route('connections.store'), pgPayload(['options' => ['mysql_ssl' => 'required']]))
        ->assertSessionHasNoErrors();

    expect(SavedConnection::sole()->options)->toBe(['sslmode' => 'prefer', 'schema' => 'public']);
});

it('validates the MySQL SSL mode', function (array $options, string $field) {
    $this->actingAs($this->user)->post(route('connections.store'), mysqlPayload(['options' => $options]))
        ->assertSessionHasErrors($field);

    expect(SavedConnection::count())->toBe(0);
})->with([
    'unknown mode' => [['mysql_ssl' => 'preferred'], 'options.mysql_ssl'],
    'verify identity without a CA' => [['mysql_ssl' => 'verify_identity', 'ssl_ca' => ''], 'options.ssl_ca'],
    'verify identity with an unsafe CA' => [['mysql_ssl' => 'verify_identity', 'ssl_ca' => '/ca.pem;host=evil'], 'options.ssl_ca'],
]);

it('requires a CA file for verify identity on the test endpoint too', function () {
    $this->actingAs($this->user)->postJson(route('connections.test'), mysqlPayload(['options' => ['mysql_ssl' => 'verify_identity']]))
        ->assertUnprocessable()->assertJsonValidationErrors('options.ssl_ca');
});

it('requires the password again when the MySQL SSL mode changes', function (array $saved, array $submitted) {
    $connection = SavedConnection::factory()->for($this->user)->create(['host' => 'db.internal', 'port' => 3306, 'database' => 'shop', 'username' => 'app', 'password' => 'original', 'options' => $saved]);

    $this->actingAs($this->user)->put(route('connections.update', $connection), mysqlPayload(['password' => '', 'options' => $submitted]))
        ->assertSessionHasErrors('password');
    $this->actingAs($this->user)->postJson(route('connections.test'), mysqlPayload(['connection_id' => $connection->id, 'password' => '', 'options' => $submitted]))
        ->assertUnprocessable()->assertJsonValidationErrors('password');
})->with([
    'disabled to required' => [[], ['mysql_ssl' => 'required']],
    'legacy CA to required' => [['ssl_ca' => '/ca.pem'], ['mysql_ssl' => 'required', 'ssl_ca' => '/ca.pem']],
    'required to disabled' => [['mysql_ssl' => 'required'], ['mysql_ssl' => 'disabled']],
    'verify identity with another CA' => [['mysql_ssl' => 'verify_identity', 'ssl_ca' => '/ca.pem'], ['mysql_ssl' => 'verify_identity', 'ssl_ca' => '/other.pem']],
]);

it('keeps the stored password when the MySQL SSL mode only spells out how a saved connection already behaved', function (array $saved, array $submitted) {
    $connection = SavedConnection::factory()->for($this->user)->create(['host' => 'db.internal', 'port' => 3306, 'database' => 'shop', 'username' => 'app', 'password' => 'original', 'options' => $saved]);

    $this->actingAs($this->user)->put(route('connections.update', $connection), mysqlPayload(['password' => '', 'options' => $submitted]))
        ->assertSessionHasNoErrors();

    expect($connection->fresh()->password)->toBe('original');
})->with([
    'no CA is disabled' => [[], ['mysql_ssl' => 'disabled']],
    'a CA is verify identity' => [['ssl_ca' => '/ca.pem'], ['mysql_ssl' => 'verify_identity', 'ssl_ca' => '/ca.pem']],
    'a CA without verification is required' => [['ssl_ca' => '/ca.pem', 'ssl_verify' => false], ['mysql_ssl' => 'required', 'ssl_ca' => '/ca.pem']],
    'a CA path left behind in required' => [['mysql_ssl' => 'required'], ['mysql_ssl' => 'required', 'ssl_ca' => '/ignored.pem']],
]);
