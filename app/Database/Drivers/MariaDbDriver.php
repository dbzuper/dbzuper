<?php

namespace App\Database\Drivers;

use App\Database\Contracts\SchemaInspector;
use App\Enums\DriverName;
use Illuminate\Database\Connection;

class MariaDbDriver extends MySqlDriver
{
    public function name(): DriverName
    {
        return DriverName::MariaDb;
    }

    public function applyStatementTimeout(Connection $db, int $seconds): void
    {
        $db->statement('SET SESSION max_statement_time = '.max(1, $seconds));
    }

    public function inspector(): SchemaInspector
    {
        return app(MariaDbInspector::class);
    }
}
