<?php

namespace App\Database;

use App\Database\Contracts\Driver;
use App\Database\Drivers\MariaDbDriver;
use App\Database\Drivers\MySqlDriver;
use App\Database\Drivers\PostgresDriver;
use App\Database\Drivers\SqliteDriver;
use App\Enums\DriverName;
use Illuminate\Contracts\Container\Container;

final class DriverRegistry
{
    public function __construct(private readonly Container $container) {}

    public function for(DriverName $name): Driver
    {
        return $this->container->make(match ($name) {
            DriverName::MySql => MySqlDriver::class,
            DriverName::MariaDb => MariaDbDriver::class,
            DriverName::Postgres => PostgresDriver::class,
            DriverName::Sqlite => SqliteDriver::class,
        });
    }
}
