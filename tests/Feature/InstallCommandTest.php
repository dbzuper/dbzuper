<?php

use App\Models\User;

it('creates the admin from options', function () {
    $this->artisan('dbzuper:install', [
        '--name' => 'Admin', '--email' => 'admin@example.com', '--password' => 'correct-horse-battery',
    ])->assertSuccessful();

    expect(User::sole()->email)->toBe('admin@example.com');
});

it('refuses when a user already exists', function () {
    User::factory()->create();

    $this->artisan('dbzuper:install', [
        '--name' => 'Admin', '--email' => 'admin2@example.com', '--password' => 'correct-horse-battery',
    ])->assertFailed();

    expect(User::count())->toBe(1);
});

it('rejects invalid input', function () {
    $this->artisan('dbzuper:install', ['--name' => 'A', '--email' => 'not-an-email', '--password' => 'short'])
        ->assertFailed();

    expect(User::count())->toBe(0);
});
