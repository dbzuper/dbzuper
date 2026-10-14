<?php

use App\Models\User;

it('redirects the home page to connections for an authenticated user', function () {
    $this->actingAs(User::factory()->create())->get('/')->assertRedirect('/connections');
});
