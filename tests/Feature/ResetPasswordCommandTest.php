<?php

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

it('resets the only account without naming it', function () {
    $user = User::factory()->create();

    $this->artisan('dbzuper:reset-password', ['--password' => 'new-password-123'])->assertSuccessful();

    expect(Hash::check('new-password-123', $user->fresh()->password))->toBeTrue();
});

it('asks for the new password twice', function () {
    $user = User::factory()->create();

    $this->artisan('dbzuper:reset-password')
        ->expectsQuestion('New password', 'new-password-123')
        ->expectsQuestion('Confirm the new password', 'new-password-123')
        ->assertSuccessful();

    expect(Hash::check('new-password-123', $user->fresh()->password))->toBeTrue();
});

it('refuses when the confirmation does not match', function () {
    $user = User::factory()->create();
    $before = $user->password;

    $this->artisan('dbzuper:reset-password')
        ->expectsQuestion('New password', 'new-password-123')
        ->expectsQuestion('Confirm the new password', 'something-else-456')
        ->assertFailed();

    expect($user->fresh()->password)->toBe($before);
});

it('needs the email when several accounts exist', function () {
    User::factory()->count(2)->create();

    $this->artisan('dbzuper:reset-password', ['--password' => 'new-password-123'])->assertFailed();
});

it('resets the named account', function () {
    User::factory()->create();
    $user = User::factory()->create(['email' => 'second@example.com']);

    $this->artisan('dbzuper:reset-password', ['email' => 'second@example.com', '--password' => 'new-password-123'])
        ->assertSuccessful();

    expect(Hash::check('new-password-123', $user->fresh()->password))->toBeTrue();
});

it('fails for an unknown email or when no account exists', function () {
    $this->artisan('dbzuper:reset-password', ['--password' => 'new-password-123'])->assertFailed();

    User::factory()->create();

    $this->artisan('dbzuper:reset-password', ['email' => 'nobody@example.com', '--password' => 'new-password-123'])
        ->assertFailed();
});

it('applies the password policy', function () {
    $user = User::factory()->create();
    $before = $user->password;

    $this->artisan('dbzuper:reset-password', ['--password' => 'short'])->assertFailed();

    expect($user->fresh()->password)->toBe($before);
});

it('signs the account out everywhere', function () {
    config(['session.driver' => 'database']);
    $user = User::factory()->create(['remember_token' => 'old-token']);
    $other = User::factory()->create();
    foreach ([$user, $other] as $i => $owner) {
        DB::table('sessions')->insert([
            'id' => "session-{$i}", 'user_id' => $owner->id, 'payload' => '', 'last_activity' => time(),
        ]);
    }

    $this->artisan('dbzuper:reset-password', ['email' => $user->email, '--password' => 'new-password-123'])
        ->assertSuccessful();

    expect(DB::table('sessions')->pluck('user_id')->all())->toBe([$other->id])
        ->and($user->fresh()->remember_token)->not->toBe('old-token');
});

it('keeps two-factor and passkeys unless asked to reset them', function (bool $reset) {
    $user = User::factory()->create([
        'two_factor_secret' => encrypt('secret'),
        'two_factor_recovery_codes' => encrypt('[]'),
        'two_factor_confirmed_at' => now(),
    ]);
    $user->passkeys()->create(['name' => 'Laptop', 'credential_id' => 'cred-1', 'credential' => []]);

    $this->artisan('dbzuper:reset-password', ['--password' => 'new-password-123', '--reset-2fa' => $reset])
        ->assertSuccessful();

    $user->refresh();
    expect($user->two_factor_secret === null)->toBe($reset)
        ->and($user->two_factor_confirmed_at === null)->toBe($reset)
        ->and($user->passkeys()->exists())->toBe(! $reset);
})->with(['kept' => false, 'reset' => true]);
