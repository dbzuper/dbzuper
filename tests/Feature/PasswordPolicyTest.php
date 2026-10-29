<?php

use App\Providers\AppServiceProvider;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

function passwordPasses(string $password): bool
{
    return Validator::make(['password' => $password], ['password' => Password::default()])->passes();
}

function inProductionWithPolicy(?string $policy): void
{
    app()->detectEnvironment(fn () => 'production');
    config(['dbzuper.password_policy' => $policy]);
    (new AppServiceProvider(app()))->boot();
}

afterEach(fn () => app()->detectEnvironment(fn () => 'testing'));

it('requires a strong password in production by default', function (?string $policy) {
    inProductionWithPolicy($policy);

    expect(passwordPasses('easypass1'))->toBeFalse()
        ->and(Password::default()->appliedRules()['uncompromised'])->toBeTrue();
})->with([null, '', 'strong', 'unknown']);

it('accepts any password of 8 characters with the basic policy', function () {
    inProductionWithPolicy('basic');

    expect(passwordPasses('easypass'))->toBeTrue()
        ->and(passwordPasses('short'))->toBeFalse()
        ->and(Password::default()->appliedRules()['uncompromised'])->toBeFalse();
});

it('reads DBZUPER_PASSWORD_POLICY from the environment', function () {
    expect(require base_path('config/dbzuper.php'))->toHaveKey('password_policy');
});
