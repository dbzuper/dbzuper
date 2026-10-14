<?php

use App\Database\Drivers\MySqlInspector;
use App\Database\Drivers\PostgresInspector;
use App\Database\Drivers\SqliteInspector;
use Tests\TestCase;

uses(TestCase::class);

function sameSchema(object $inspector, ?string $foreign, string $current): bool
{
    return (fn () => $this->sameSchema($foreign, $current))->call($inspector);
}

it('compares MySQL and MariaDB schemas case-insensitively', function () {
    $inspector = app(MySqlInspector::class);

    expect(sameSchema($inspector, 'Shop', 'shop'))->toBeTrue()
        ->and(sameSchema($inspector, 'SHOP', 'shop'))->toBeTrue()
        ->and(sameSchema($inspector, 'other', 'shop'))->toBeFalse()
        ->and(sameSchema($inspector, null, 'shop'))->toBeTrue();
});

it('compares PostgreSQL and SQLite schemas exactly', function (string $class) {
    $inspector = app($class);

    expect(sameSchema($inspector, 'Sales', 'sales'))->toBeFalse()
        ->and(sameSchema($inspector, 'sales', 'sales'))->toBeTrue()
        ->and(sameSchema($inspector, null, 'sales'))->toBeTrue();
})->with([PostgresInspector::class, SqliteInspector::class]);
