<?php

use App\Models\User;

it('limits API requests per user per minute, 120 by default', function () {
    expect(config('dbsuperb.api_per_minute'))->toBe(120);
});

it('takes the API limit from the configuration', function () {
    config(['dbsuperb.api_per_minute' => 2]);
    $user = User::factory()->create();

    $this->actingAs($user)->getJson(route('api.history.all'))->assertOk();
    $this->actingAs($user)->getJson(route('api.history.all'))->assertOk();
    $this->actingAs($user)->getJson(route('api.history.all'))->assertTooManyRequests();
});
