<?php

namespace App\Database\Contracts;

use App\Database\CellValue;
use App\Database\Query\StatementResult;
use App\Database\Sql\Classification;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use Illuminate\Contracts\Database\Query\Expression;
use Illuminate\Database\Connection;

interface Driver
{
    public function name(): DriverName;

    /**
     * Laravel runtime connection config, including the read-only guard. With $countMatchedRows, UPDATE reports the
     * rows its WHERE matched, not only those it changed (MySQL/MariaDB count changed rows unless told otherwise).
     */
    public function config(SavedConnection $connection, bool $countMatchedRows = false): array;

    public function inspector(): SchemaInspector;

    /**
     * Databases to connect to, in order, when a server-level connection needs the server rather than one database
     * (testing it, listing its databases). '' connects without choosing one.
     *
     * @return list<string>
     */
    public function maintenanceDatabases(): array;

    /** @return list<string> databases on the server the login can see */
    public function listDatabaseNames(Connection $db): array;

    /**
     * Table counts and sizes in bytes per database, from one catalog query; databases or values it can't cover are
     * left out or null. May throw or time out: callers treat it as optional.
     *
     * @return array<string, array{tables: ?int, bytes: ?int}>
     */
    public function databaseStats(Connection $db): array;

    /** @return list<string> databases the engine itself owns, hidden from the list by default */
    public function systemDatabases(): array;

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
    public function sampleColumn(Connection $db, string $column, string $typeName, int $maxChars = CellValue::MAX_CHARS): Expression|string;

    /** SQL expression usable on the left of LIKE for any column type. */
    public function likeColumn(string $quotedColumn): string;

    /** Pattern operator for case-insensitive matching: LIKE where the default collation is already case-insensitive. */
    public function likeOperator(): string;

    /** Quote one identifier as a single name (no splitting on dots). */
    public function quoteIdentifier(string $name): string;
}
