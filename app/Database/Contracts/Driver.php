<?php

namespace App\Database\Contracts;

use App\Enums\DriverName;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;

interface Driver
{
    public function name(): DriverName;

    /** Laravel runtime connection config, including the read-only guard. */
    public function config(SavedConnection $connection): array;

    public function inspector(): SchemaInspector;

    /** SQL returning one row with a `version` column. */
    public function versionQuery(): string;

    /** Bound how long any single statement on this session may run. */
    public function applyStatementTimeout(Connection $db, int $seconds): void;
}
