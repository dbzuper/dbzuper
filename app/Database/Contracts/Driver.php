<?php

namespace App\Database\Contracts;

use App\Enums\DriverName;
use App\Models\SavedConnection;

interface Driver
{
    public function name(): DriverName;

    /** Laravel runtime connection config, including the read-only guard. */
    public function config(SavedConnection $connection): array;

    public function inspector(): SchemaInspector;

    /** SQL returning one row with a `version` column. */
    public function versionQuery(): string;
}
