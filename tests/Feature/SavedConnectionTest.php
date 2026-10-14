<?php

use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\User;
use Illuminate\Support\Facades\DB;

it('encrypts password and options at rest', function () {
    $connection = SavedConnection::factory()->create([
        'password' => 's3cret-pass', 'options' => ['sslmode' => 'require'],
    ]);

    $raw = DB::table('connections')->where('id', $connection->id)->first();
    expect($raw->password)->not->toContain('s3cret-pass')
        ->and($raw->options)->not->toContain('require')
        ->and($connection->fresh()->password)->toBe('s3cret-pass')
        ->and($connection->fresh()->options)->toBe(['sslmode' => 'require'])
        ->and($connection->fresh()->driver)->toBe(DriverName::MySql);
});

it('never exposes the password in client arrays or JSON', function () {
    $connection = SavedConnection::factory()->create(['password' => 's3cret-pass']);

    $client = $connection->toClientArray();
    expect($client)->not->toHaveKey('password')
        ->and($client['has_password'])->toBeTrue()
        ->and(json_encode($client))->not->toContain('s3cret-pass')
        ->and($connection->toJson())->not->toContain('s3cret-pass');
});

it('only lets the owner view, update or delete', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $connection = SavedConnection::factory()->for($owner)->create();

    foreach (['view', 'update', 'delete'] as $ability) {
        expect($owner->can($ability, $connection))->toBeTrue()
            ->and($other->can($ability, $connection))->toBeFalse();
    }
});
