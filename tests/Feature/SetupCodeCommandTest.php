<?php

use App\Models\User;
use App\Support\SetupCode;

beforeEach(fn () => app(SetupCode::class)->forget());
afterEach(fn () => app(SetupCode::class)->forget());

it('prints the setup code and where to enter it while no admin exists', function () {
    config(['app.url' => 'https://db.example.test']);

    $this->artisan('dbzuper:setup-code')
        ->expectsOutput('Open https://db.example.test/setup and enter the setup code '.app(SetupCode::class)->current())
        ->assertSuccessful();
});

it('prints nothing to enter once the admin exists', function () {
    User::factory()->create();

    $this->artisan('dbzuper:setup-code')
        ->expectsOutputToContain('Setup is complete')
        ->assertSuccessful();
    expect(is_file(config('dbzuper.setup_code_path')))->toBeFalse();
});

it('retires the setup code when the admin is created on the command line', function () {
    $code = app(SetupCode::class)->current();

    $this->artisan('dbzuper:install', [
        '--name' => 'Admin', '--email' => 'admin@example.com', '--password' => 'correct-horse-battery',
    ])->assertSuccessful();

    expect(app(SetupCode::class)->matches($code))->toBeFalse();
});
