<?php

use App\Http\Middleware\RedirectToSetup;
use App\Models\User;
use Illuminate\Support\Facades\DB;

it('caches only a positive admin-exists answer', function () {
    expect(RedirectToSetup::adminExists())->toBeFalse();

    User::factory()->create();
    expect(RedirectToSetup::adminExists())->toBeTrue();

    DB::enableQueryLog();
    expect(RedirectToSetup::adminExists())->toBeTrue()
        ->and(DB::getQueryLog())->toBeEmpty();
});

it('does not query users on every request once an admin exists', function () {
    $this->withoutVite();
    $user = User::factory()->create();
    $this->actingAs($user)->get('/connections')->assertOk();

    DB::enableQueryLog();
    $this->actingAs($user)->get('/connections')->assertOk();

    $userExistsQueries = collect(DB::getQueryLog())->filter(fn ($q) => str_contains($q['query'], 'exists') && str_contains($q['query'], '"users"'));
    expect($userExistsQueries)->toBeEmpty();
});

it('starts every test without the cached answer', function () {
    expect(RedirectToSetup::adminExists())->toBeFalse();
    $this->get('/')->assertRedirect(route('setup.show'));
});
