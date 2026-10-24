<?php

use App\Models\SavedConnection;
use App\Models\User;

beforeEach(fn () => $this->withoutVite());

it('records when the workspace was last opened without touching updated_at', function () {
    $user = User::factory()->create();
    $connection = SavedConnection::factory()->for($user)->create();
    $updatedAt = $connection->fresh()->updated_at;
    expect($connection->fresh()->last_opened_at)->toBeNull()
        ->and($connection->fresh()->toClientArray()['last_opened_at'])->toBeNull();

    $this->travel(5)->minutes();
    $this->actingAs($user)->get(route('workspace.show', $connection))->assertOk();

    $fresh = $connection->fresh();
    expect($fresh->last_opened_at->toIso8601String())->toBe(now()->toIso8601String())
        ->and($fresh->updated_at->equalTo($updatedAt))->toBeTrue()
        ->and($fresh->toClientArray()['last_opened_at'])->toBe(now()->toIso8601String());
});

it('skips the write when the connection was opened under a minute ago', function () {
    $user = User::factory()->create();
    $connection = SavedConnection::factory()->for($user)->create();

    $this->actingAs($user)->get(route('workspace.show', $connection))->assertOk();
    $first = $connection->fresh()->last_opened_at;

    $this->travel(30)->seconds();
    $this->actingAs($user)->get(route('workspace.show', $connection))->assertOk();
    expect($connection->fresh()->last_opened_at->equalTo($first))->toBeTrue();

    $this->travel(31)->seconds();
    $this->actingAs($user)->get(route('workspace.show', $connection))->assertOk();
    expect($connection->fresh()->last_opened_at->greaterThan($first))->toBeTrue();
});

it('does not record a visit that is forbidden', function () {
    $connection = SavedConnection::factory()->create();

    $this->actingAs(User::factory()->create())->get(route('workspace.show', $connection))->assertForbidden();

    expect($connection->fresh()->last_opened_at)->toBeNull();
});
