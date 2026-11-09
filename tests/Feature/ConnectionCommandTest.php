<?php

use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\User;

it('adds a server-level connection for the administrator', function () {
    $admin = User::factory()->create();

    $this->artisan('dbzuper:connection', [
        'name' => 'laman MariaDB', '--driver' => 'mariadb', '--port' => '3306', '--username' => 'root',
    ])->assertSuccessful();

    $c = SavedConnection::sole();
    expect($c->user_id)->toBe($admin->id)
        ->and($c->driver)->toBe(DriverName::MariaDb)
        ->and($c->host)->toBe('127.0.0.1')
        ->and($c->port)->toBe(3306)
        ->and($c->database)->toBeNull()
        ->and($c->password)->toBeNull()
        ->and($c->isServerLevel())->toBeTrue();
});

it('stores a password encrypted and uses the driver default port', function () {
    User::factory()->create();

    $this->artisan('dbzuper:connection', [
        'name' => 'pg', '--driver' => 'pgsql', '--username' => 'postgres', '--password' => 's3cret',
    ])->assertSuccessful();

    $c = SavedConnection::sole();
    expect($c->port)->toBe(5432)->and($c->password)->toBe('s3cret')
        ->and(DB::table('connections')->value('password'))->not->toBe('s3cret');
});

it('does nothing with --if-missing when the name exists', function () {
    User::factory()->create();
    $args = ['name' => 'laman MariaDB', '--driver' => 'mariadb', '--username' => 'root', '--if-missing' => true];

    $this->artisan('dbzuper:connection', $args)->assertSuccessful();
    $this->artisan('dbzuper:connection', $args)->assertSuccessful();

    expect(SavedConnection::count())->toBe(1);
});

it('applies the form validation', function () {
    User::factory()->create();

    $this->artisan('dbzuper:connection', ['name' => 'bad', '--driver' => 'mariadb', '--host' => 'db;host=evil', '--username' => 'root'])
        ->assertFailed();
    $this->artisan('dbzuper:connection', ['name' => 'bad', '--driver' => 'oracle', '--username' => 'root'])
        ->assertFailed();

    expect(SavedConnection::count())->toBe(0);
});

it('needs an account to own the connection', function () {
    $this->artisan('dbzuper:connection', ['name' => 'x', '--driver' => 'mariadb', '--username' => 'root'])
        ->assertFailed();

    User::factory()->create();
    $this->artisan('dbzuper:connection', ['name' => 'x', '--driver' => 'mariadb', '--username' => 'root', '--user' => 'nobody@example.com'])
        ->assertFailed();

    expect(SavedConnection::count())->toBe(0);
});
