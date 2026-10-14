<?php

use Tests\Support\Engines;

it('can open a connection to the engine test database', function (string $engine) {
    Engines::skipUnlessAvailable($engine);

    $value = Engines::pdo($engine)->query('select 1')->fetchColumn();

    expect((int) $value)->toBe(1);
})->with(Engines::ENGINES);
