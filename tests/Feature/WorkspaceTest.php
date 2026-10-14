<?php

use App\Models\SavedConnection;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(fn () => $this->withoutVite());

it('renders the workspace for the owner without the password', function () {
    $user = User::factory()->create();
    $connection = SavedConnection::factory()->for($user)->create(['password' => 'top-secret']);

    $response = $this->actingAs($user)->get(route('workspace.show', $connection));

    $response->assertInertia(fn (Assert $page) => $page->component('workspace/show')->where('connection.id', $connection->id));
    expect($response->getContent())->not->toContain('top-secret');
});

it('forbids other users', function () {
    $connection = SavedConnection::factory()->create();

    $this->actingAs(User::factory()->create())->get(route('workspace.show', $connection))->assertForbidden();
});
