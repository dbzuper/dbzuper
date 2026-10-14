<?php

use App\Enums\DriverName;

it('knows default ports and server-ness', function () {
    expect(DriverName::MySql->defaultPort())->toBe(3306)
        ->and(DriverName::MariaDb->defaultPort())->toBe(3306)
        ->and(DriverName::Postgres->defaultPort())->toBe(5432)
        ->and(DriverName::Sqlite->defaultPort())->toBeNull()
        ->and(DriverName::Sqlite->isServer())->toBeFalse()
        ->and(DriverName::Postgres->label())->toBe('PostgreSQL');
});
