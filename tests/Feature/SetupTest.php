<?php

use App\Models\User;

it('redirects every page to setup while no user exists', function () {
    $this->get('/login')->assertRedirect(route('setup.show'));
    $this->get('/')->assertRedirect(route('setup.show'));
});

it('shows the setup page when no user exists', function () {
    $this->get(route('setup.show'))->assertOk();
});

it('creates the first admin, verifies them and logs them in', function () {
    $this->post(route('setup.store'), [
        'name' => 'Admin',
        'email' => 'admin@example.com',
        'password' => 'correct-horse-battery',
        'password_confirmation' => 'correct-horse-battery',
    ])->assertRedirect(route('connections.index'));

    $user = User::sole();
    expect($user->email)->toBe('admin@example.com')
        ->and($user->email_verified_at)->not->toBeNull();
    $this->assertAuthenticatedAs($user);
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
