<?php

use App\Models\User;

it('limits API requests per user per minute, 120 by default', function () {
    expect(config('dbzuper.api_per_minute'))->toBe(120);
});

it('takes the API limit from the configuration', function () {
    config(['dbzuper.api_per_minute' => 2]);
    $user = User::factory()->create();

    $this->actingAs($user)->getJson(route('api.history.all'))->assertOk();
    $this->actingAs($user)->getJson(route('api.history.all'))->assertOk();
    $this->actingAs($user)->getJson(route('api.history.all'))->assertTooManyRequests();
});

it('never lets a zero or negative setting refuse every API request', function (string $setting, int $expected) {
    $previous = getenv('DBZUPER_API_PER_MINUTE');
    putenv("DBZUPER_API_PER_MINUTE={$setting}");
    $_ENV['DBZUPER_API_PER_MINUTE'] = $_SERVER['DBZUPER_API_PER_MINUTE'] = $setting;

    try {
        expect((require config_path('dbzuper.php'))['api_per_minute'])->toBe($expected);
    } finally {
        $previous === false ? putenv('DBZUPER_API_PER_MINUTE') : putenv("DBZUPER_API_PER_MINUTE={$previous}");
        unset($_ENV['DBZUPER_API_PER_MINUTE'], $_SERVER['DBZUPER_API_PER_MINUTE']);
    }
})->with([['-5', 1], ['0', 120], ['abc', 120], ['30', 30]]);
