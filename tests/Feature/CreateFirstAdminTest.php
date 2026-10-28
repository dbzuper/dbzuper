<?php

use App\Actions\CreateFirstAdmin;
use App\Models\User;
use Illuminate\Support\Facades\Cache;

function adminInput(): array
{
    return [
        'name' => 'Admin', 'email' => 'admin@example.com',
        'password' => 'correct-horse-battery', 'password_confirmation' => 'correct-horse-battery',
    ];
}

it('creates a verified admin when none exists', function () {
    $user = app(CreateFirstAdmin::class)->handle(adminInput());

    expect($user)->not->toBeNull()
        ->and($user->email_verified_at)->not->toBeNull()
        ->and(User::count())->toBe(1);
});

it('returns null and creates nothing when a user exists', function () {
    User::factory()->create();

    expect(app(CreateFirstAdmin::class)->handle(adminInput()))->toBeNull()
        ->and(User::count())->toBe(1);
});

it('fails cleanly when another holder owns the setup lock', function () {
    $lock = Cache::lock('dbzuper:setup', 10);
    expect($lock->get())->toBeTrue();

    expect(app(CreateFirstAdmin::class)->handle(adminInput(), 0))->toBeNull()
        ->and(User::count())->toBe(0);

    $lock->release();
});

it('re-checks inside the lock', function () {
    $lock = Cache::lock('dbzuper:setup', 10);
    $lock->get();

    // Simulate a racing request that wins while we wait: it creates the admin, then releases.
    User::factory()->create();
    $lock->release();

    expect(app(CreateFirstAdmin::class)->handle(adminInput()))->toBeNull()
        ->and(User::count())->toBe(1);
});
