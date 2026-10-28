<?php

namespace App\Database\Editing;

use App\Database\CellValue;
use App\Database\ColumnKind;
use App\Database\Contracts\Driver;
use App\Database\Schema\ColumnInfo;
use App\Database\Schema\TableInfo;
use App\Enums\DriverName;
use Closure;
use Illuminate\Database\Connection;

/**
 * Builds the statements of a change set (spec §5, §6, §7) from the table snapshot and its edit plan. Every
 * identifier comes from the snapshot and is quoted by the driver; every value is bound. Nothing is executed here.
 *
 * Shortened values: the grid shows at most CellValue::RESULT_CHARS characters of a value and locks any cell that
 * was cut (Task 2), so a client never holds a longer value it read from the table. Any `original` value (or
 * all-values identity value) longer than that is therefore one the user never saw whole and is rejected; the client
 * omits the originals of locked cells. Updated columns must come with their original, which is how the server knows
 * the cell wasn't locked. New values may be longer (up to ChangeSet::MAX_VALUE_CHARS): the user typed them.
 *
 * @phpstan-import-type TableArray from TableInfo
 * @phpstan-import-type ColumnArray from ColumnInfo
 *
 * @phpstan-type Fragment array{sql: string, preview: string, bindings: list<mixed>}
 */
final class ChangeSetBuilder
{
    private EditPlan $plan;

    /** @var TableArray */
    private array $table;

    private Driver $driver;

    private Connection $db;

    /** @var array<string, ColumnArray> */
    private array $columns;

    /**
     * @param  TableArray  $table  the snapshot table
     * @param  array<int, mixed>  $changes  the request's changes
     * @return list<BuiltStatement> in execution order (deletes, updates, inserts)
     *
     * @throws ChangeSetRejected
     */
    public function build(EditPlan $plan, array $table, Driver $driver, Connection $db, array $changes): array
    {
        if ($table['kind'] !== 'table') {
            throw new ChangeSetRejected('changes', "This table can't be edited: views can't be edited.");
        }
        if (! $plan->editable()) {
            throw new ChangeSetRejected('changes', "This table can't be edited: {$plan->reason}.");
        }

        $chars = 0;
        array_walk_recursive($changes, function ($v) use (&$chars) {
            $chars += is_string($v) ? mb_strlen($v) : 0;
        });
        if ($chars > ChangeSet::MAX_TOTAL_CHARS) {
            throw new ChangeSetRejected('changes', 'The change set is too large: its values add up to more than '.number_format(ChangeSet::MAX_TOTAL_CHARS).' characters.');
        }

        $run = new self;
        $run->plan = $plan;
        $run->table = $table;
        $run->driver = $driver;
        $run->db = $db;
        $run->columns = array_column($table['columns'], null, 'name');

        $built = [];
        foreach (array_values($changes) as $i => $change) {
            $change = is_array($change) ? $change : [];
            $built[] = match ($change['op'] ?? null) {
                'insert' => $run->insert($i, $change),
                'update' => $run->update($i, $change),
                'delete' => $run->delete($i, $change),
                default => throw new ChangeSetRejected("changes.{$i}.op", 'The op must be insert, update or delete.'),
            };
        }

        return ChangeSet::ordered($built);
    }

    /** @param array<string, mixed> $change */
    private function insert(int $i, array $change): BuiltStatement
    {
        $values = $this->writes($i, $change, insert: true);
        $table = $this->q($this->table['name']);

        if ($values === []) {
            $sql = $this->mysql()
                ? $this->raw("INSERT INTO {$table} () VALUES ()")
                : $this->raw("INSERT INTO {$table} DEFAULT VALUES");
        } else {
            $sql = $this->cat(
                $this->raw("INSERT INTO {$table} (".implode(', ', array_map($this->q(...), array_keys($values))).') VALUES ('),
                $this->join(', ', array_map(fn ($v) => $this->param($v), array_values($values))),
                $this->raw(')'),
            );
        }

        return $this->statement($i, 'insert', $sql, 'new row');
    }

    /** @param array<string, mixed> $change */
    private function update(int $i, array $change): BuiltStatement
    {
        [$where, $target] = $this->pin($i, $change);
        $values = $this->writes($i, $change, insert: false);
        $original = $this->originals($i, $change);
        $shortened = $this->shortened($i, $change);
        foreach (array_keys($values) as $column) {
            if (in_array($column, $shortened, true)) {
                throw new ChangeSetRejected("changes.{$i}.values", "Column \"{$column}\" was shortened for display, so it can't be replaced.");
            }
            if (! array_key_exists($column, $original)) {
                throw new ChangeSetRejected("changes.{$i}.original", "The original value of \"{$column}\" is missing.");
            }
        }

        // Optimistic check (spec §5): the edited columns must still hold what the user saw.
        $checks = match ($this->plan->method) {
            EditMethod::PrimaryKey, EditMethod::UniqueIndex, EditMethod::SqliteRowid => array_map(
                fn (string $column) => $this->compare($column, $original[$column]),
                array_values(array_filter(
                    array_keys($values),
                    fn (string $c) => ! in_array($c, $this->plan->keyColumns, true) && $this->comparable($c),
                )),
            ),
            default => [],
        };

        $sql = $this->cat(
            $this->raw('UPDATE '.$this->q($this->table['name']).' SET '),
            $this->join(', ', array_map(
                fn (string $column, $v) => $this->cat($this->raw($this->q($column).' = '), $this->param($v)),
                array_keys($values),
                array_values($values),
            )),
            $this->raw(' WHERE '),
            $this->join(' AND ', [...$where, ...$checks]),
            $this->raw($this->plan->method === EditMethod::MysqlAllValues ? ' LIMIT 1' : ''),
        );

        return $this->statement($i, 'update', $sql, $target);
    }

    /** @param array<string, mixed> $change */
    private function delete(int $i, array $change): BuiltStatement
    {
        [$where, $target] = $this->pin($i, $change);
        $this->originals($i, $change); // validated even where the method doesn't compare them
        $this->shortened($i, $change);

        $sql = $this->cat(
            $this->raw('DELETE FROM '.$this->q($this->table['name']).' WHERE '),
            $this->join(' AND ', $where),
            $this->raw($this->plan->method === EditMethod::MysqlAllValues ? ' LIMIT 1' : ''),
        );

        return $this->statement($i, 'delete', $sql, $target);
    }

    /**
     * The WHERE conditions that pin the change's row, and a short description of the row for Review.
     *
     * @param  array<string, mixed>  $change
     * @return array{0: list<Fragment>, 1: string}
     */
    private function pin(int $i, array $change): array
    {
        $field = "changes.{$i}.id";
        $id = $change['id'] ?? null;
        if (! is_array($id) || $id === []) {
            throw new ChangeSetRejected($field, 'An update or delete needs the row identity.');
        }
        $mismatch = fn () => new ChangeSetRejected($field, "The row identity doesn't match how this table pins rows ({$this->plan->method->value}).");

        switch ($this->plan->method) {
            case EditMethod::PrimaryKey:
            case EditMethod::UniqueIndex:
                $this->expectKeys($id, ['key'], $mismatch);
                $key = $id['key'];
                if (! is_array($key) || ! $this->sameKeys($key, $this->plan->keyColumns)) {
                    throw $mismatch();
                }
                $where = $target = [];
                foreach ($this->plan->keyColumns as $column) {
                    if ($key[$column] === null || is_array($key[$column])) {
                        throw $mismatch();
                    }
                    $value = $this->matchValue($key[$column], $field, $column, ChangeSet::MAX_VALUE_CHARS);
                    $where[] = $this->cat($this->raw($this->q($column).' = '), $this->param($value));
                    $target[] = $column.' = '.(is_int($key[$column]) ? (string) $key[$column] : $this->db->escape($value));
                }

                return [$where, implode(', ', $target)];

            case EditMethod::SqliteRowid:
                $this->expectKeys($id, ['rowid'], $mismatch);
                $rowid = $id['rowid'];
                // FILTER_VALIDATE_INT refuses values outside the 64-bit range instead of saturating them.
                $rowid = is_int($rowid) || is_string($rowid) ? filter_var($rowid, FILTER_VALIDATE_INT) : false;
                if ($rowid === false) {
                    throw $mismatch();
                }
                $alias = EditMethodResolver::sqliteRowidAlias(array_keys($this->columns));

                return [[$this->cat($this->raw("{$alias} = "), $this->param($rowid))], 'rowid '.$rowid];

            case EditMethod::PgCtid:
                $this->expectKeys($id, $this->plan->needsTableoid ? ['ctid', 'xmin', 'filenode', 'tableoid'] : ['ctid', 'xmin', 'filenode'], $mismatch);
                $ctid = $id['ctid'];
                $xmin = $this->oid($id['xmin']);
                $filenode = $this->oid($id['filenode']);
                $tableoid = $this->plan->needsTableoid ? $this->oid($id['tableoid']) : null;
                if (! is_string($ctid) || ! preg_match('/^\((0|[1-9]\d{0,9}),[1-9]\d{0,4}\)$/', $ctid)
                    || $xmin === null || $filenode === null || ($this->plan->needsTableoid && $tableoid === null)) {
                    throw $mismatch();
                }
                // ctid is a slot in one relation file, and neither it nor xmin is unique on its own: rows inserted
                // by one transaction share xmin, a slot is reused after VACUUM, and VACUUM FULL / CLUSTER rewrite the
                // table (new ctids, same xmin) into a new file. The file node pins the physical file, ctid the slot in
                // it, xmin the row version that was loaded.
                $where = [];
                if ($tableoid !== null) {
                    $where[] = $this->cat($this->raw('tableoid = '), $this->param($tableoid, '?::oid'));
                }
                $where[] = $this->cat($this->raw('ctid = '), $this->param($ctid, '?::tid'));
                $where[] = $this->cat($this->raw('xmin = '), $this->param($xmin, '?::xid'));
                $where[] = $this->cat($this->raw('pg_relation_filenode(tableoid) = '), $this->param($filenode, '?::oid'));
                // Defence in depth: every exactly comparable original must still match, except the cells the client
                // only holds shortened (listed in `shortened`).
                $original = $this->originals($i, $change);
                $shortened = $this->shortened($i, $change);
                foreach (array_keys($this->columns) as $column) {
                    if (! $this->comparable($column) || in_array($column, $shortened, true)) {
                        continue;
                    }
                    if (! array_key_exists($column, $original)) {
                        throw new ChangeSetRejected("changes.{$i}.original", "The original value of \"{$column}\" is missing (list it in shortened if you only have it shortened).");
                    }
                    $where[] = $this->compare($column, $original[$column]);
                }

                return [$where, 'ctid '.$ctid.($tableoid !== null ? ' in tableoid '.$tableoid : '')];

            case EditMethod::MysqlAllValues:
                $this->expectKeys($id, ['values'], $mismatch);
                $values = $id['values'];
                if (! is_array($values) || ! $this->sameKeys($values, array_keys($this->columns))) {
                    throw $mismatch();
                }
                foreach (array_keys($this->columns) as $column) {
                    if (! $this->comparable($column)) {
                        throw new ChangeSetRejected($field, "Rows of this table can't be pinned: \"{$column}\" can't be compared exactly.");
                    }
                }
                $where = [];
                foreach (array_keys($this->columns) as $column) {
                    if (is_array($values[$column])) {
                        throw $mismatch();
                    }
                    $where[] = $this->compare($column, $this->matchValue($values[$column], $field, $column, CellValue::RESULT_CHARS), nullSafe: true);
                }

                return [$where, 'matched by all values'];

            default:
                throw $mismatch();
        }
    }

    /**
     * The validated values to write, in request order.
     *
     * @param  array<string, mixed>  $change
     * @return array<string, ?string>
     */
    private function writes(int $i, array $change, bool $insert): array
    {
        $field = "changes.{$i}.values";
        $values = $change['values'] ?? [];
        if (! is_array($values)) {
            throw new ChangeSetRejected($field, 'The values must be an object of column values.');
        }
        if ($values === [] && ! $insert) {
            throw new ChangeSetRejected($field, 'Nothing to update.');
        }

        $out = [];
        foreach ($values as $column => $value) {
            $column = (string) $column;
            $this->known($field, $column);
            if (! $this->writable($column, $insert)) {
                throw new ChangeSetRejected($field, "Column \"{$column}\" can't be edited.");
            }
            $out[$column] = match (true) {
                $value === null => null,
                is_bool($value) => $this->bool($value),
                is_string($value) => $this->text($value, $field, $column, ChangeSet::MAX_VALUE_CHARS),
                default => throw new ChangeSetRejected($field, "The value of \"{$column}\" must be text or null."),
            };
        }

        return $out;
    }

    /**
     * The change's original values, converted for matching. Every one must have been shown whole.
     *
     * @param  array<string, mixed>  $change
     * @return array<string, string|int|float|null>
     */
    private function originals(int $i, array $change): array
    {
        $field = "changes.{$i}.original";
        $original = $change['original'] ?? [];
        if (! is_array($original)) {
            throw new ChangeSetRejected($field, 'The original values must be an object of column values.');
        }

        $out = [];
        foreach ($original as $column => $value) {
            $column = (string) $column;
            $this->known($field, $column);
            if (is_array($value)) {
                throw new ChangeSetRejected($field, "The original value of \"{$column}\" must be a single value.");
            }
            $out[$column] = $this->matchValue($value, $field, $column, CellValue::RESULT_CHARS);
        }

        return $out;
    }

    /** A value the row is matched against: as bound, with JSON numbers and booleans in the engine's text form. */
    private function matchValue(mixed $value, string $field, string $column, int $maxChars): string|int|float|null
    {
        return match (true) {
            $value === null => null,
            is_bool($value) => $this->bool($value),
            // SQLite only converts text to a number for columns with numeric affinity (an untyped or REAL column
            // would never equal the text '7' or '1.5'); the other engines convert text to the column's type.
            is_int($value), is_float($value) => $this->driver->name() === DriverName::Sqlite ? $value : $this->number($value),
            is_string($value) => $maxChars === CellValue::RESULT_CHARS && mb_strlen($value) > $maxChars
                ? throw new ChangeSetRejected($field, "The original value of \"{$column}\" was shortened for display, so it can't be matched or replaced.")
                : $this->text($value, $field, $column, $maxChars),
            default => throw new ChangeSetRejected($field, "The value of \"{$column}\" must be text or null."),
        };
    }

    /** An unsigned 32-bit catalogue number (xid, oid) as canonical text: 1..4294967295, no leading zeros. */
    private function oid(mixed $value): ?string
    {
        $text = is_int($value) || is_string($value) ? (string) $value : '';

        return preg_match('/^[1-9]\d{0,9}$/', $text) && (int) $text <= 4294967295 ? $text : null;
    }

    /**
     * The change's `shortened` list: columns whose value the client only holds shortened (locked cells), so it
     * can't send their original. Only types the grid can shorten qualify; such a column has no original and can't
     * be written.
     *
     * @param  array<string, mixed>  $change
     * @return list<string>
     */
    private function shortened(int $i, array $change): array
    {
        $field = "changes.{$i}.shortened";
        $list = $change['shortened'] ?? [];
        if (! is_array($list) || ! array_is_list($list)) {
            throw new ChangeSetRejected($field, 'shortened must be a list of column names.');
        }
        $original = is_array($change['original'] ?? null) ? $change['original'] : [];
        foreach ($list as $column) {
            if (! is_string($column)) {
                throw new ChangeSetRejected($field, 'shortened must be a list of column names.');
            }
            $this->known($field, $column);
            if (! $this->canBeShortened($column)) {
                throw new ChangeSetRejected($field, "Values of \"{$column}\" are never shortened for display.");
            }
            if (array_key_exists($column, $original)) {
                throw new ChangeSetRejected($field, "Column \"{$column}\" can't be both shortened and sent as an original.");
            }
        }

        return array_values(array_unique($list));
    }

    /**
     * Whether the grid can shorten this column's values: anything shown as text that can exceed
     * CellValue::RESULT_CHARS. Numbers, booleans, dates, times and UUIDs never do.
     */
    private function canBeShortened(string $column): bool
    {
        $type = strtolower(trim($this->typeName($column)));
        if (str_starts_with($type, '_') || str_ends_with($type, '[]')) {
            return true; // PostgreSQL arrays print as long text
        }

        return ! preg_match('/^(tinyint|smallint|mediumint|int|integer|bigint|int2|int4|int8|serial\d?|bigserial|smallserial|oid|xid'
            .'|decimal|numeric|dec|fixed|money|float\d*|real|double( precision)?'
            .'|bool|boolean|bit|year|date|datetime|time|timetz|timestamp|timestamptz|interval|uuid)(\s+unsigned)?$/', $type)
            && ! preg_match('/^(time|timestamp)( with(out)? time zone)?$/', $type);
    }

    /** A number's exact text: floats in their shortest round-trip form. */
    private function number(int|float $value): string
    {
        return is_float($value) ? (string) json_encode($value) : (string) $value;
    }

    private function text(string $value, string $field, string $column, int $maxChars): string
    {
        if (str_contains($value, "\0")) {
            throw new ChangeSetRejected($field, "The value of \"{$column}\" contains a NUL character.");
        }
        if (mb_strlen($value) > $maxChars) {
            throw new ChangeSetRejected($field, "The value of \"{$column}\" is longer than ".number_format($maxChars).' characters.');
        }

        return $value;
    }

    /** Booleans as each engine stores them (spec §6). */
    private function bool(bool $value): string
    {
        return $this->driver->name() === DriverName::Postgres ? ($value ? 'true' : 'false') : ($value ? '1' : '0');
    }

    private function known(string $field, string $column): void
    {
        if (! isset($this->columns[$column])) {
            throw new ChangeSetRejected($field, "Unknown column \"{$column}\".");
        }
    }

    /**
     * Mirrors the grid's static locks: generated/identity-always, binary, and (all-values) inexact columns. An insert
     * matches no row, so comparability doesn't matter there.
     */
    private function writable(string $column, bool $insert): bool
    {
        return ! in_array($column, $this->plan->readOnlyColumns, true)
            && ColumnKind::classify($this->typeName($column)) !== ColumnKind::Binary
            && ($insert || $this->plan->method !== EditMethod::MysqlAllValues || $this->comparable($column));
    }

    private function comparable(string $column): bool
    {
        return ColumnComparability::forPlan($this->driver->name(), $this->columns[$column], $this->plan);
    }

    /**
     * `col = ?` (`IS NULL` for a NULL original) or, null-safe, `col <=> ?`. MySQL/MariaDB text is compared byte for
     * byte: converted to utf8mb4 (the connection's charset, so the bound text has the same bytes) and cast to binary.
     * Even utf8mb4_bin is PAD SPACE, so a collation alone would let 'a' match 'a '.
     *
     * @return Fragment
     */
    private function compare(string $column, string|int|float|null $value, bool $nullSafe = false): array
    {
        $q = $this->q($column);
        if ($this->mysql()) {
            $text = $this->mysqlText($column);
            $lhs = $text ? "CAST(CONVERT({$q} USING utf8mb4) AS BINARY)" : $q;
            $rhs = $text ? 'CAST(? AS BINARY)' : '?';

            return match (true) {
                $nullSafe => $this->cat($this->raw("{$lhs} <=> "), $this->param($value, $rhs)),
                $value === null => $this->raw("{$q} IS NULL"),
                default => $this->cat($this->raw("{$lhs} = "), $this->param($value, $rhs)),
            };
        }

        return $value === null
            ? $this->raw("{$q} IS NULL")
            : $this->cat($this->raw("{$q} = "), $this->param($value));
    }

    private function mysqlText(string $column): bool
    {
        $type = strtolower($this->typeName($column));

        return ColumnKind::classify($type) === ColumnKind::Text || in_array($type, ['enum', 'set'], true);
    }

    private function typeName(string $column): string
    {
        return $this->columns[$column]['type_name'] ?? '';
    }

    private function mysql(): bool
    {
        return in_array($this->driver->name(), [DriverName::MySql, DriverName::MariaDb], true);
    }

    private function q(string $name): string
    {
        return $this->driver->quoteIdentifier($name);
    }

    /**
     * @param  array<mixed>  $id
     * @param  list<string>  $keys
     * @param  Closure(): ChangeSetRejected  $mismatch
     */
    private function expectKeys(array $id, array $keys, Closure $mismatch): void
    {
        if (! $this->sameKeys($id, $keys)) {
            throw $mismatch();
        }
    }

    /**
     * @param  array<mixed>  $data
     * @param  list<string>  $expected
     */
    private function sameKeys(array $data, array $expected): bool
    {
        $keys = array_map('strval', array_keys($data));
        sort($keys);
        sort($expected);

        return $keys === $expected;
    }

    /** @param Fragment $sql */
    private function statement(int $i, string $op, array $sql, string $target): BuiltStatement
    {
        return new BuiltStatement($i, $op, $sql['sql'], $sql['bindings'], $sql['preview'], $target);
    }

    /* SQL fragments carry the placeholder form, the preview form (literals inlined like rows.sql) and the bindings. */

    /** @return Fragment */
    private function raw(string $sql): array
    {
        return ['sql' => $sql, 'preview' => $sql, 'bindings' => []];
    }

    /**
     * @param  string  $wrap  the placeholder, possibly inside a cast; it holds exactly one `?`
     * @return Fragment
     */
    private function param(string|int|float|null $value, string $wrap = '?'): array
    {
        if (is_float($value)) {
            // Only SQLite keeps floats (see matchValue). PDO binds them as text, which an untyped column holding the
            // real 0.1 would never equal, so the cast makes the comparison numeric.
            $value = $this->number($value);
            $wrap = str_replace('?', 'CAST(? AS REAL)', $wrap);
        }

        return ['sql' => $wrap, 'preview' => str_replace('?', $this->db->escape($value), $wrap), 'bindings' => [$value]];
    }

    /**
     * @param  Fragment  ...$parts
     * @return Fragment
     */
    private function cat(array ...$parts): array
    {
        return $this->join('', $parts);
    }

    /**
     * @param  array<Fragment>  $parts
     * @return Fragment
     */
    private function join(string $separator, array $parts): array
    {
        return [
            'sql' => implode($separator, array_column($parts, 'sql')),
            'preview' => implode($separator, array_column($parts, 'preview')),
            'bindings' => array_merge(...array_column($parts, 'bindings')),
        ];
    }
}
