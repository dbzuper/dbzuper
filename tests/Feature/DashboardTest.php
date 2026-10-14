<?php

use App\Models\User;

it('redirects guests to the login page', function () {
    User::factory()->create();

    $this->get(route('dashboard'))->assertRedirect(route('login'));
});

it('redirects authenticated users to connections', function () {
    $this->actingAs(User::factory()->create())
        ->get(route('dashboard'))
        ->assertRedirect('/connections');
});
