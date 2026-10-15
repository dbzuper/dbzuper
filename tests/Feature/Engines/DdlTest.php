<?php

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Support\Demo\CommerceSchema;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

it('returns native DDL where the engine has it', function (string $engine, ?string $expected) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);

    $ddl = app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($saved) {
        CommerceSchema::drop($db);
        CommerceSchema::create($db);
        try {
            return app(DriverRegistry::class)->for($saved->driver)->ddl($db, 'group', 'table');
        } finally {
            CommerceSchema::drop($db);
        }
    });

    $expected === null ? expect($ddl)->toBeNull() : expect($ddl)->toContain($expected);
})->with([
    'mysql' => ['mysql', 'CREATE TABLE `group`'],
    'mariadb' => ['mariadb', 'CREATE TABLE `group`'],
    'pgsql' => ['pgsql', null],
]);
