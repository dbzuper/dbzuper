<?php

use App\Database\ConnectionFactory;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

it('re-applies the statement timeout after a reconnect', function (string $engine, string $sql, string $expected) {
    Engines::skipUnlessAvailable($engine);

    $value = app(ConnectionFactory::class)->using(Engines::savedConnection($engine), function (Connection $db) use ($sql) {
        $db->reconnect();

        return (string) array_values((array) $db->selectOne($sql))[0];
    }, 7);

    expect($value)->toBe($expected);
})->with([
    'pgsql' => ['pgsql', 'show statement_timeout', '7s'],
    'mysql' => ['mysql', 'select @@session.max_execution_time', '7000'],
]);
