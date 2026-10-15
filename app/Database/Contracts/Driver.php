<?php

namespace App\Database\Contracts;

use App\Database\Query\StatementResult;
use App\Database\Sql\Classification;
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

    /** Run one statement, returning capped rows or the affected count. Throws on DB errors. */
    public function execute(Connection $db, string $sql, Classification $classification, int $maxRows, int $maxBytes): StatementResult;

    /** Re-assert the session's read-only mode; dynamic SQL could have switched it off. Throws on DB errors. */
    public function enforceReadOnly(Connection $db): void;

    /** Prefix that turns a statement into its plan. */
    public function explainPrefix(): string;

    /** Native CREATE statement for a table or view, or null when the engine has none. */
    public function ddl(Connection $db, string $table, string $kind): ?string;

    /** Select expression, aliased to the column name, that bounds a value's size in SQL for sampling. */
    public function sampleColumn(Connection $db, string $column, string $typeName): Expression|string;

    /** Quote one identifier as a single name (no splitting on dots). */
    public function quoteIdentifier(string $name): string;
}
