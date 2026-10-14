<?php

namespace App\Database\Drivers;

use App\Enums\DriverName;

class MariaDbDriver extends MySqlDriver
{
    public function name(): DriverName
    {
        return DriverName::MariaDb;
    }
}
