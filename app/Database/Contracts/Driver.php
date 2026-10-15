<?php

namespace App\Database\Contracts;

use App\Enums\DriverName;
use App\Models\SavedConnection;
use Illuminate\Contracts\Database\Query\Expression;
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

    /** Native CREATE statement for a table or view, or null when the engine has none. */
    public function ddl(Connection $db, string $table, string $kind): ?string;

    /** Select expression, aliased to the column name, that bounds a value's size in SQL for sampling. */
    public function sampleColumn(Connection $db, string $column, string $typeName): Expression|string;

    /** Quote one identifier as a single name (no splitting on dots). */
    public function quoteIdentifier(string $name): string;
}
