<?php

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Schema\SchemaSnapshot;
use App\Support\Demo\CommerceSchema;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

afterEach(fn () => Engines::resetSqlite());

function inspectCommerceSqlite(): SchemaSnapshot
{
    $saved = Engines::savedConnection('sqlite');

    return app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($saved) {
        CommerceSchema::create($db);

        return app(DriverRegistry::class)->for($saved->driver)->inspector()->inspect($db, $saved);
    });
}

it('keeps every object below the cap', function () {
    config(['dbsuperb.schema_max_objects' => 5000]);

    $array = inspectCommerceSqlite()->toArray();

    expect($array['truncated'])->toBeFalse()
        ->and($array['total_objects'])->toBe(10)
        ->and($array['tables'])->toHaveCount(10);
});

it('keeps the first N objects alphabetically and drops dangling relationships when over the cap', function () {
    config(['dbsuperb.schema_max_objects' => 3]);

    $snapshot = inspectCommerceSqlite();
    $array = $snapshot->toArray();
    $names = collect($snapshot->tables)->pluck('name')->all();

    expect($array['truncated'])->toBeTrue()
        ->and($array['total_objects'])->toBe(10)
        ->and($names)->toBe(['audit_log', 'categories', 'group']);

    foreach ($snapshot->relationships as $relationship) {
        expect($names)->toContain($relationship->fromTable)->toContain($relationship->toTable);
    }
});
