<?php

namespace App\Database\Editing;

use App\Database\CellValue;
use App\Database\ColumnKind;
use App\Database\Contracts\Driver;
use App\Enums\DriverName;
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
 */
final class ChangeSetBuilder
{
    private EditPlan $plan;

    private array $table;

    private Driver $driver;

    private Connection $db;

    /** @var array<string, array> */
    private array $columns;

    /**
     * @param  array{name: string, kind?: string, columns: list<array>}  $table  the snapshot table
     * @param  array<int, mixed>  $changes  the request's changes
     * @return list<BuiltStatement> in execution order (deletes, updates, inserts)
     *
     * @throws ChangeSetRejected
     */
    public function build(EditPlan $plan, array $table, Driver $driver, Connection $db, array $changes): array
    {
        if (($table['kind'] ?? 'table') !== 'table') {
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

    private function update(int $i, array $change): BuiltStatement
    {
        [$where, $target] = $this->pin($i, $change);
        $values = $this->writes($i, $change, insert: false);
        $original = $this->originals($i, $change);
        foreach (array_keys($values) as $column) {
            if (! array_key_exists($column, $original)) {
                throw new ChangeSetRejected("changes.{$i}.original", "The original value of \"{$column}\" is missing.");
            }
        }

        // Optimistic check (spec §5): the edited columns must still hold what the user saw.
        $checks = match ($this->plan->method) {
            EditMethod::PrimaryKey, EditMethod::UniqueIndex, EditMethod::SqliteRowid, EditMethod::PgCtid => array_map(
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

    private function delete(int $i, array $change): BuiltStatement
    {
        [$where, $target] = $this->pin($i, $change);
        $this->originals($i, $change); // validated even where the method doesn't compare them

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
     * @return array{0: list<array>, 1: string}
     */
    private function pin(int $i, array $change): array
    {
        $field = "changes.{$i}.id";
        $id = $change['id'] ?? null;
        if (! is_array($id) || $id === []) {
            throw new ChangeSetRejected($field, 'An update or delete needs the row identity.');
        }
        $mismatch = fn () => new ChangeSetRejected($field, "The row identity doesn't match how this table pins rows ({$this->plan->method->value}).");
        $shape = fn (array $keys) => $this->sameKeys($id, $keys) ? null : throw $mismatch();

        switch ($this->plan->method) {
            case EditMethod::PrimaryKey:
            case EditMethod::UniqueIndex:
                $shape(['key']);
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
                $shape(['rowid']);
                $rowid = $id['rowid'];
                // FILTER_VALIDATE_INT refuses values outside the 64-bit range instead of saturating them.
                $rowid = is_int($rowid) || is_string($rowid) ? filter_var($rowid, FILTER_VALIDATE_INT) : false;
                if ($rowid === false) {
                    throw $mismatch();
                }
                $alias = EditMethodResolver::sqliteRowidAlias(array_keys($this->columns));

                return [[$this->cat($this->raw("{$alias} = "), $this->param($rowid))], 'rowid '.$rowid];

            case EditMethod::PgCtid:
                $shape($this->plan->needsTableoid ? ['ctid', 'xmin', 'tableoid'] : ['ctid', 'xmin']);
                $ctid = $id['ctid'];
                $xmin = is_int($id['xmin']) || is_string($id['xmin']) ? (string) $id['xmin'] : '';
                $tableoid = $id['tableoid'] ?? null;
                if (! is_string($ctid) || ! preg_match('/^\(\d{1,10},\d{1,5}\)$/', $ctid) || ! preg_match('/^\d{1,10}$/', $xmin)
                    || ($this->plan->needsTableoid && ! preg_match('/^\d{1,10}$/', is_int($tableoid) || is_string($tableoid) ? (string) $tableoid : ''))) {
                    throw $mismatch();
                }
                $where = [];
                if ($this->plan->needsTableoid) {
                    $where[] = $this->cat($this->raw('tableoid = '), $this->param((string) $tableoid, '?::oid'));
                }
                // ctid plus xmin pin one row version: a reused ctid slot or a row changed since loading has another xmin.
                $where[] = $this->cat($this->raw('ctid = '), $this->param($ctid, '?::tid'));
                $where[] = $this->cat($this->raw('xmin = '), $this->param($xmin, '?::xid'));
                // Any change by another transaction gives the row a new xmin, so no other value needs checking; an
                // UPDATE still checks the columns it writes, like the key methods (spec §5.1).

                return [$where, 'ctid '.$ctid.($this->plan->needsTableoid ? ' in tableoid '.$tableoid : '')];

            case EditMethod::MysqlAllValues:
                $shape(['values']);
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
        return ColumnComparability::exact($this->driver->name(), $this->columns[$column]);
    }

    /**
     * `col = ?` (`IS NULL` for a NULL original) or, null-safe, `col <=> ?`. MySQL/MariaDB text is compared byte for
     * byte: converted to utf8mb4 (the connection's charset, so the bound text has the same bytes) and cast to binary.
     * Even utf8mb4_bin is PAD SPACE, so a collation alone would let 'a' match 'a '.
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
        return (string) ($this->columns[$column]['type_name'] ?? $this->columns[$column]['type'] ?? '');
    }

    private function mysql(): bool
    {
        return in_array($this->driver->name(), [DriverName::MySql, DriverName::MariaDb], true);
    }

    private function q(string $name): string
    {
        return $this->driver->quoteIdentifier($name);
    }

    /** @param list<string> $expected */
    private function sameKeys(array $data, array $expected): bool
    {
        $keys = array_map('strval', array_keys($data));
        sort($keys);
        sort($expected);

        return $keys === $expected;
    }

    private function statement(int $i, string $op, array $sql, string $target): BuiltStatement
    {
        return new BuiltStatement($i, $op, $sql['sql'], $sql['bindings'], $sql['preview'], $target);
    }

    /* SQL fragments carry the placeholder form, the preview form (literals inlined like rows.sql) and the bindings. */

    /** @return array{sql: string, preview: string, bindings: list<mixed>} */
    private function raw(string $sql): array
    {
        return ['sql' => $sql, 'preview' => $sql, 'bindings' => []];
    }

    /** @param string $wrap the placeholder, possibly inside a cast; it holds exactly one `?` */
    private function param(string|int|float|null $value, string $wrap = '?'): array
    {
        $literal = is_float($value) ? $this->number($value) : $this->db->escape($value);

        return ['sql' => $wrap, 'preview' => str_replace('?', $literal, $wrap), 'bindings' => [$value]];
    }

    private function cat(array ...$parts): array
    {
        return $this->join('', $parts);
    }

    /** @param list<array> $parts */
    private function join(string $separator, array $parts): array
    {
        return [
            'sql' => implode($separator, array_column($parts, 'sql')),
            'preview' => implode($separator, array_column($parts, 'preview')),
            'bindings' => array_merge(...array_column($parts, 'bindings')),
        ];
    }
}
