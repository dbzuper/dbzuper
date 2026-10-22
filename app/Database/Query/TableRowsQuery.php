<?php

namespace App\Database\Query;

use App\Database\CellValue;
use App\Database\ColumnKind;
use App\Database\Contracts\Driver;
use App\Database\Editing\ColumnComparability;
use App\Database\Editing\EditMethod;
use App\Database\Editing\EditMethodResolver;
use App\Database\Editing\EditPlan;
use App\Enums\DriverName;
use Illuminate\Database\Connection;
use Illuminate\Database\Query\Builder;

final class TableRowsQuery
{
    public const OPS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains', 'starts_with', 'ends_with', 'is_null', 'is_not_null'];

    /** Alias prefix for the raw identity columns; extended when a real column starts with it. */
    private const ALIAS_PREFIX = '__dbsuperb_';

    private const COMPARE = ['eq' => '=', 'neq' => '<>', 'lt' => '<', 'lte' => '<=', 'gt' => '>', 'gte' => '>='];

    /**
     * @param  array{name: string, columns: list<array{name: string, type_name: string, type: string}>}  $table
     * @param  list<array{column: string, op: string, value?: ?string}>  $filters
     * @param  list<array{column: string, direction: string}>  $sort
     * @param  ?EditPlan  $plan  how rows are pinned for editing; null means not editable
     * @return array{columns: list<array{name:string,type:?string,table:string}>, rows: list<list<mixed>>, has_more: bool, sql: string, editing: array{method:string,reason:?string,read_only_columns:list<string>}, row_ids: list<?array>, locked: list<list<int>>, shortened: list<list<int>>}
     *
     * `shortened` lists, per row, the cells whose shown value isn't the stored one (cut, or a non-NULL binary value): a
     * change lists these columns in its `shortened` instead of sending their originals.
     */
    public static function run(Connection $db, Driver $driver, array $table, array $filters, array $sort, int $page, int $perPage, ?EditPlan $plan = null): array
    {
        $plan ??= EditPlan::none('editing is not available here');
        $q = fn (string $name) => $driver->quoteIdentifier($name);
        $sortColumns = array_column($sort, 'column');
        $order = array_map(fn ($s) => [$s['column'], $s['direction'] === 'desc' ? 'desc' : 'asc'], $sort);
        // The primary key is the (tie-breaking) last sort key so OFFSET paging is deterministic.
        foreach (self::primaryKey($table) as $column) {
            if (! in_array($column, $sortColumns, true)) {
                $order[] = [$column, 'asc'];
            }
        }

        $build = function (array $select, int $limit, bool $literal) use ($db, $driver, $table, $filters, $order, $page, $perPage, $q): Builder {
            $query = $db->table($db->raw($q($table['name'])))->select($select);
            self::applyFilters($query, $db, $driver, $filters, $literal);
            foreach ($order as [$column, $direction]) {
                $query->orderByRaw($q($column).' '.$direction);
            }

            return $query->offset(($page - 1) * $perPage)->limit($limit);
        };

        $query = $build(array_merge(array_map(
            fn ($c) => $driver->sampleColumn($db, $c['name'], strtolower((string) ($c['type_name'] ?? '')), CellValue::RESULT_CHARS),
            $table['columns'],
        ), array_map(fn (string $sql) => $db->raw($sql), self::identitySelect($driver, $table, $plan))), $perPage + 1, false);
        // The user-facing query: raw quoted columns, values inlined with the connection's own quoting
        // (never Builder::toRawSql, whose scanner misreads quoted identifiers), exactly the page asked for.
        $sql = $build(array_map(fn ($c) => $db->raw($q($c['name'])), $table['columns']), $perPage, true)->toSql();

        $fetched = $query->get()->all();
        $more = count($fetched) > $perPage;
        $width = count($table['columns']);
        $static = self::staticLocks($driver, $table, $plan);
        $binary = array_keys(array_filter($table['columns'], fn ($c) => ColumnKind::classify((string) ($c['type_name'] ?? $c['type'] ?? '')) === ColumnKind::Binary));
        $blobFlags = self::sqliteBlobFlags($driver, $table) !== null;
        $rows = $rowIds = $locked = $shortened = [];
        foreach (array_slice($fetched, 0, $perPage) as $row) {
            $values = array_values((array) $row);
            // SQLite stores a BLOB in any column: such a cell shows as text it doesn't hold, so it is never editable.
            $blobs = $blobFlags ? array_keys(array_filter(str_split((string) array_pop($values)), fn ($f) => $f === '1')) : [];
            $cells = array_map(fn ($v) => is_resource($v) ? stream_get_contents($v) : $v, array_slice($values, 0, $width));
            $inexact = array_values(array_unique(array_merge(array_keys(array_filter($cells, fn ($v) => ! self::shownWhole($v))), $blobs)));
            $rows[] = array_map(fn ($v) => CellValue::present($v, CellValue::RESULT_CHARS), $cells);
            $cellLocks = array_values(array_unique(array_merge($inexact, $static['locked'])));
            sort($cellLocks);
            $locked[] = $cellLocks;
            // Binary values may be sampled into a placeholder that looks whole, so any non-NULL binary cell counts.
            $cut = array_values(array_unique(array_merge($inexact, array_filter($binary, fn (int $i) => $cells[$i] !== null))));
            sort($cut);
            $shortened[] = $cut;
            $rowIds[] = self::rowId($plan, $table, $cells, array_slice($values, $width), $inexact !== [] || $static['unmatchable'], $blobs);
        }

        return [
            'columns' => array_map(fn ($c) => ['name' => $c['name'], 'type' => $c['type'], 'table' => $table['name']], $table['columns']),
            'rows' => $rows,
            'has_more' => $more,
            'sql' => $sql,
            'editing' => ['method' => $plan->method->value, 'reason' => $plan->reason, 'read_only_columns' => $plan->readOnlyColumns],
            'row_ids' => $rowIds,
            'locked' => $locked,
            'shortened' => $shortened,
        ];
    }

    /**
     * Raw select expressions, appended after the shown columns, that carry each row's identity. They never go
     * through sampleColumn: identity values must be exact, not shortened for display. On SQLite the BLOB flags (see
     * sqliteBlobFlags) come last.
     *
     * @return list<string>
     */
    private static function identitySelect(Driver $driver, array $table, EditPlan $plan): array
    {
        $names = array_map(fn ($c) => (string) $c['name'], $table['columns']);
        // Aliases carry a prefix no real column starts with, so they can never collide with one.
        $prefix = self::ALIAS_PREFIX;
        while (array_filter($names, fn ($n) => str_starts_with(strtolower($n), strtolower($prefix))) !== []) {
            $prefix = self::ALIAS_PREFIX.bin2hex(random_bytes(4)).'_';
        }
        $as = fn (string $expr, string $alias) => $expr.' AS '.$driver->quoteIdentifier($prefix.$alias);

        $flags = self::sqliteBlobFlags($driver, $table);

        return [...match ($plan->method) {
            EditMethod::PrimaryKey, EditMethod::UniqueIndex => array_map(
                fn (string $column, int $i) => $as($driver->quoteIdentifier($column), 'k'.$i),
                $plan->keyColumns,
                array_keys($plan->keyColumns),
            ),
            EditMethod::SqliteRowid => [$as(EditMethodResolver::sqliteRowidAlias($names), 'rowid')],
            // ctid is a slot in one relation file; the file node pins the file (VACUUM FULL, CLUSTER and rewriting
            // ALTERs make a new one) and xmin the row version loaded (a slot is reused after VACUUM).
            EditMethod::PgCtid => [
                $as('ctid::text', 'ctid'),
                $as('xmin::text', 'xmin'),
                $as('pg_relation_filenode(tableoid)::text', 'filenode'),
                ...($plan->needsTableoid ? [$as('tableoid::text', 'tableoid')] : []),
            ],
            EditMethod::MysqlAllValues, EditMethod::None => [],
        }, ...($flags !== null ? [$as($flags, 'blobs')] : [])];
    }

    /**
     * SQLite only: one select expression yielding a '0'/'1' flag per column, '1' where the cell holds a BLOB. It is
     * the last identity expression, so run() reads it as the row's last value.
     */
    private static function sqliteBlobFlags(Driver $driver, array $table): ?string
    {
        if ($driver->name() !== DriverName::Sqlite || $table['columns'] === []) {
            return null;
        }

        return '('.implode(' || ', array_map(
            fn ($c) => "(typeof({$driver->quoteIdentifier((string) $c['name'])}) = 'blob')",
            $table['columns'],
        )).')';
    }

    /**
     * Column indexes locked on every row: binary, generated/read-only, and under the all-values method the columns
     * that can't be compared exactly. `unmatchable` says whether such a column makes every all-values row unpinnable.
     *
     * @return array{locked: list<int>, unmatchable: bool}
     */
    private static function staticLocks(Driver $driver, array $table, EditPlan $plan): array
    {
        $locked = [];
        $unmatchable = false;
        foreach ($table['columns'] as $i => $column) {
            $binary = ColumnKind::classify((string) ($column['type_name'] ?? $column['type'] ?? '')) === ColumnKind::Binary;
            $inexact = $plan->method === EditMethod::MysqlAllValues && ! ColumnComparability::forPlan($driver->name(), $column, $plan);
            $unmatchable = $unmatchable || $inexact;
            if ($binary || $inexact || in_array($column['name'], $plan->readOnlyColumns, true)) {
                $locked[] = $i;
            }
        }

        return ['locked' => $locked, 'unmatchable' => $unmatchable];
    }

    /** Whether the grid shows the fetched value whole: not cut to the result cap and not a binary placeholder. */
    private static function shownWhole(mixed $value): bool
    {
        return ! is_string($value) || (mb_check_encoding($value, 'UTF-8') && mb_strlen($value) <= CellValue::RESULT_CHARS);
    }

    /**
     * @param  list<mixed>  $cells  the fetched (sampled) cell values
     * @param  list<mixed>  $raw  the raw identity columns, in identitySelect order
     * @param  bool  $unmatchable  some value of this row is shortened, binary or not exactly comparable
     * @param  list<int>  $blobs  indexes of SQLite cells holding a BLOB
     */
    private static function rowId(EditPlan $plan, array $table, array $cells, array $raw, bool $unmatchable, array $blobs = []): ?array
    {
        $raw = array_map(fn ($v) => is_resource($v) ? stream_get_contents($v) : $v, $raw);

        switch ($plan->method) {
            case EditMethod::PrimaryKey:
            case EditMethod::UniqueIndex:
                $types = array_column($table['columns'], 'type_name', 'name');
                $key = [];
                $positions = array_flip(array_column($table['columns'], 'name'));
                foreach ($plan->keyColumns as $i => $column) {
                    $value = $raw[$i] ?? null;
                    if (in_array($positions[$column] ?? -1, $blobs, true)) {
                        return null; // a BLOB key would travel as text it doesn't equal
                    }
                    // A binary key can't travel through JSON exactly, so the row can't be pinned.
                    if (ColumnKind::classify((string) ($types[$column] ?? '')) === ColumnKind::Binary
                        || (is_string($value) && ! mb_check_encoding($value, 'UTF-8'))) {
                        return null;
                    }
                    $key[$column] = self::exactValue($value);
                }

                return ['key' => $key];
            case EditMethod::SqliteRowid:
                return ['rowid' => (string) $raw[0]];
            case EditMethod::PgCtid:
                return $plan->needsTableoid
                    ? ['ctid' => (string) $raw[0], 'xmin' => (string) $raw[1], 'filenode' => (string) $raw[2], 'tableoid' => (string) $raw[3]]
                    : ['ctid' => (string) $raw[0], 'xmin' => (string) $raw[1], 'filenode' => (string) $raw[2]];
            case EditMethod::MysqlAllValues:
                // Identity would be a guess when any value was shortened, is binary, or can't be compared exactly.
                if ($unmatchable) {
                    return null;
                }
                $values = [];
                foreach ($table['columns'] as $i => $column) {
                    $values[$column['name']] = self::exactValue($cells[$i]);
                }

                return ['values' => $values];
            default:
                return null;
        }
    }

    /** The exact JSON form of a raw value, as record keys carry it: big integers as strings, booleans as text. */
    private static function exactValue(mixed $value): string|int|float|null
    {
        $value = CellValue::present($value, PHP_INT_MAX);

        return is_bool($value) ? ($value ? 'true' : 'false') : $value;
    }

    /** @return list<string> */
    private static function primaryKey(array $table): array
    {
        foreach ($table['indexes'] ?? [] as $index) {
            if (! empty($index['primary'])) {
                return array_values($index['columns']);
            }
        }

        return [];
    }

    /** @param  list<array{column: string, op: string, value?: ?string}>  $filters */
    public static function applyFilters(Builder $query, Connection $db, Driver $driver, array $filters, bool $literal): void
    {
        foreach ($filters as $f) {
            self::apply($query, $db, $driver, $driver->quoteIdentifier($f['column']), $f['op'], $f['value'] ?? null, $literal);
        }
    }

    private static function apply(Builder $query, Connection $db, Driver $driver, string $column, string $op, ?string $value, bool $literal): void
    {
        // Inlines the value at the placeholder position only: a "?" inside a quoted column name is never touched.
        $where = function (string $before, string $after, string $bound) use ($query, $db, $literal): void {
            $literal
                ? $query->whereRaw($before.$db->escape($bound).$after)
                : $query->whereRaw($before.'?'.$after, [$bound]);
        };

        if ($op === 'is_null' || $op === 'is_not_null') {
            $query->whereRaw($column.($op === 'is_null' ? ' IS NULL' : ' IS NOT NULL'));

            return;
        }
        if (isset(self::COMPARE[$op])) {
            $where($column.' '.self::COMPARE[$op].' ', '', $value ?? '');

            return;
        }
        $escaped = str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $value ?? '');
        $pattern = match ($op) {
            'contains' => "%{$escaped}%",
            'starts_with' => "{$escaped}%",
            'ends_with' => "%{$escaped}",
        };
        $where($driver->likeColumn($column).' '.$driver->likeOperator().' ', " ESCAPE '!'", $pattern);
    }
}
