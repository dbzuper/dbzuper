<?php

use App\Models\User;
use App\Support\SetupCode;

beforeEach(fn () => app(SetupCode::class)->forget());
afterEach(fn () => app(SetupCode::class)->forget());

function setupInput(array $overrides = []): array
{
    return array_merge([
        'setup_code' => app(SetupCode::class)->current(),
        'name' => 'Admin',
        'email' => 'admin@example.com',
        'password' => 'correct-horse-battery',
        'password_confirmation' => 'correct-horse-battery',
    ], $overrides);
}

it('redirects every page to setup while no user exists', function () {
    $this->get('/login')->assertRedirect(route('setup.show'));
    $this->get('/')->assertRedirect(route('setup.show'));
});

it('shows the setup page when no user exists', function () {
    $this->get(route('setup.show'))->assertOk();
});

it('issues the setup code when the setup page is shown', function () {
    $this->get(route('setup.show'))->assertOk();

    expect(is_file(config('dbzuper.setup_code_path')))->toBeTrue();
});

it('creates the first admin, verifies them and logs them in', function () {
    $this->post(route('setup.store'), setupInput())->assertRedirect(route('connections.index'));

    $user = User::sole();
    expect($user->email)->toBe('admin@example.com')
        ->and($user->email_verified_at)->not->toBeNull();
    $this->assertAuthenticatedAs($user);
});

it('refuses to create the admin without the right setup code', function (?string $code) {
    $this->from(route('setup.show'))
        ->post(route('setup.store'), setupInput(['setup_code' => $code]))
        ->assertRedirect(route('setup.show'))
        ->assertSessionHasErrors('setup_code');

    expect(User::count())->toBe(0);
    $this->assertGuest();
})->with(['missing' => [null], 'wrong' => ['AAAA-AAAA-AAAA']]);

it('accepts the setup code however it is typed', function () {
    $code = strtolower(str_replace('-', ' ', app(SetupCode::class)->current()));

    $this->post(route('setup.store'), setupInput(['setup_code' => $code]))->assertRedirect(route('connections.index'));
    expect(User::count())->toBe(1);
});

it('retires the setup code once the admin exists', function () {
    $code = app(SetupCode::class)->current();
    $this->post(route('setup.store'), setupInput(['setup_code' => $code]));

    expect(is_file(config('dbzuper.setup_code_path')))->toBeFalse()
        ->and(app(SetupCode::class)->matches($code))->toBeFalse();
});

it('locks setup once a user exists', function () {
    User::factory()->create();

    $this->get(route('setup.show'))->assertNotFound();
    $this->post(route('setup.store'), [
        'name' => 'Intruder', 'email' => 'x@example.com',
        'password' => 'correct-horse-battery', 'password_confirmation' => 'correct-horse-battery',
    ])->assertNotFound();
    expect(User::count())->toBe(1);
});

it('has public registration disabled', function () {
    User::factory()->create();

    $this->get('/register')->assertNotFound();
});
