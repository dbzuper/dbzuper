<?php

use App\Models\User;
use Illuminate\Support\Facades\Notification;
use Inertia\Testing\AssertableInertia as Assert;

it('hides the reset link and its routes while mail sends nothing', function () {
    config(['mail.default' => 'log']);
    Notification::fake();
    $user = User::factory()->create();

    $this->get(route('login'))
        ->assertInertia(fn (Assert $page) => $page->component('auth/login')->where('canResetPassword', false));
    $this->get(route('password.request'))->assertNotFound();
    $this->post(route('password.email'), ['email' => $user->email])->assertNotFound();
    $this->get(route('password.reset', 'token'))->assertNotFound();
    $this->post(route('password.update'), [
        'token' => 'token', 'email' => $user->email, 'password' => 'password', 'password_confirmation' => 'password',
    ])->assertNotFound();

    Notification::assertNothingSent();
});

it('offers the reset link once a mailer is set up', function () {
    config(['mail.default' => 'smtp']);
    User::factory()->create();

    $this->get(route('login'))
        ->assertInertia(fn (Assert $page) => $page->where('canResetPassword', true));
    $this->get(route('password.request'))->assertOk();
});
