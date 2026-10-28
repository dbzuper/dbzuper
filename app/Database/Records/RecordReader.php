<?php

namespace App\Database\Records;

use App\Database\CellValue;
use App\Database\Contracts\Driver;
use App\Database\Schema\ColumnInfo;
use App\Database\Schema\Relationship;
use App\Database\Schema\SchemaSnapshot;
use App\Database\Schema\TableInfo;
use Illuminate\Database\Connection;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;

/**
 * @phpstan-import-type SnapshotArray from SchemaSnapshot
 * @phpstan-import-type TableArray from TableInfo
 * @phpstan-import-type ColumnArray from ColumnInfo
 * @phpstan-import-type RelationshipArray from Relationship
 *
 * @phpstan-type Count array{value: int, capped: bool}
 * @phpstan-type RelationSummary array{id: string, direction: 'in'|'out', table: string, columns: list<string>, other_columns: list<string>, inferred: bool, available: bool, count: Count|null}
 * @phpstan-type CanonicalKey array<string, string|int|float|null>
 */
final class RecordReader
{
    public const COUNT_CAP = 10000;

    public const MAX_COUNTED = 12;

    /** Wall-clock seconds one record read may spend on child counts; once spent, the remaining counts are skipped. */
    public const COUNT_BUDGET_SECONDS = 2.0;

    public function __construct(private readonly float $countBudgetSeconds = self::COUNT_BUDGET_SECONDS) {}

    /**
     * @param  SnapshotArray  $snapshot
     * @param  TableArray  $table
     * @return array{table: string, key: CanonicalKey, columns: list<array{name: string, type: string}>, values: list<string|int|float|bool|null>, relationships: list<RelationSummary>}|null
     */
    public function read(Connection $db, Driver $driver, array $snapshot, array $table, RecordKey $key): ?array
    {
        // Raw copies of the key and relationship columns: the display values are truncated or replaced
        // (long text, binary), which would corrupt availability checks, counts and the canonical key.
        $rawNames = array_values(array_unique(array_merge($key->columns(), $this->relationshipColumns($snapshot, $table['name']))));
        // Raw copies carry a per-request alias prefix that no real column uses, so they cannot collide with one.
        $names = array_column($table['columns'], 'name');
        do {
            $prefix = '__r'.bin2hex(random_bytes(4)).'_';
            $clash = array_filter($names, fn ($n) => str_starts_with((string) $n, $prefix)) !== [];
        } while ($clash);
        $select = array_map(fn ($c) => $driver->sampleColumn($db, $c['name'], strtolower($c['type_name']), CellValue::RESULT_CHARS), $table['columns']);
        foreach ($rawNames as $i => $name) {
            $select[] = $db->raw($driver->quoteIdentifier($name).' AS '.$driver->quoteIdentifier($prefix.$i));
        }

        try {
            $row = $this->where($db->table($db->raw($driver->quoteIdentifier($table['name']))), $driver, $key->columns(), $key->values())
                ->select($select)
                ->first();
        } catch (QueryException $e) {
            // SQLSTATE class 22 (data exception): the key value cannot be a value of the column, so no such record.
            if ($this->isDataException($e)) {
                return null;
            }
            throw $e;
        }
        if ($row === null) {
            return null;
        }
        $assoc = (array) $row;
        $display = [];
        foreach ($table['columns'] as $c) {
            $display[] = CellValue::present($assoc[$c['name']] ?? null, CellValue::RESULT_CHARS);
        }
        $raw = [];
        foreach ($rawNames as $i => $name) {
            $raw[$name] = $assoc[$prefix.$i] ?? null;
        }
        $canonical = [];
        foreach ($key->columns() as $name) {
            $value = CellValue::present($raw[$name], PHP_INT_MAX);
            // Booleans cannot be sent back as a key value, so they travel as text.
            $canonical[$name] = is_bool($value) ? ($value ? 'true' : 'false') : $value;
        }

        return [
            'table' => $table['name'],
            'key' => $canonical,
            'columns' => array_map(fn ($c) => ['name' => $c['name'], 'type' => $c['type']], $table['columns']),
            'values' => $display,
            'relationships' => $this->relationships($db, $driver, $snapshot, $table['name'], $raw),
        ];
    }

    /**
     * The parent (dir=out) or children (dir=in) of a record across one relationship, keyset-paged by the target's primary key.
     * Relationship columns, keys and cursors use raw (unbounded) values; only the displayed values are bounded.
     *
     * @param  TableArray  $source
     * @param  RelationshipArray  $rel
     * @param  'in'|'out'  $dir
     * @param  TableArray  $target
     * @param  list<string|int|float|null>|null  $after  decoded cursor: the previous page's last canonical key values
     * @return array{rows: list<array{key: CanonicalKey, values: list<string|int|float|bool|null>}>, next_after: ?list<string|int|float|null>}|null null when the source record is missing
     */
    public function related(Connection $db, Driver $driver, array $source, RecordKey $key, array $rel, string $dir, array $target, int $limit, ?array $after): ?array
    {
        $sourceColumns = $dir === 'out' ? $rel['from_columns'] : $rel['to_columns'];
        $targetColumns = $dir === 'out' ? $rel['to_columns'] : $rel['from_columns'];
        $prefix = $this->aliasPrefix($source['columns']);
        $select = [];
        foreach ($sourceColumns as $i => $name) {
            $select[] = $db->raw($driver->quoteIdentifier($name).' AS '.$driver->quoteIdentifier($prefix.$i));
        }

        try {
            $row = $this->where($db->table($db->raw($driver->quoteIdentifier($source['name']))), $driver, $key->columns(), $key->values())
                ->select($select)
                ->first();
        } catch (QueryException $e) {
            if ($this->isDataException($e)) {
                return null;
            }
            throw $e;
        }
        if ($row === null) {
            return null;
        }
        $assoc = (array) $row;
        $values = [];
        foreach ($sourceColumns as $i => $name) {
            $v = $assoc[$prefix.$i] ?? null;
            $values[] = is_resource($v) ? stream_get_contents($v) : $v;
        }
        $empty = ['rows' => [], 'next_after' => null];
        if (in_array(null, $values, true)) {
            return $empty;
        }

        $pk = $target['primary_key'];
        $tprefix = $this->aliasPrefix($target['columns']);
        $select = array_map(fn ($c) => $driver->sampleColumn($db, $c['name'], strtolower($c['type_name']), CellValue::MAX_CHARS), $target['columns']);
        foreach ($pk as $i => $name) {
            $select[] = $db->raw($driver->quoteIdentifier($name).' AS '.$driver->quoteIdentifier($tprefix.$i));
        }
        $query = $this->where($db->table($db->raw($driver->quoteIdentifier($target['name']))), $driver, $targetColumns, $values)->select($select);
        if ($after !== null) {
            $query->where(function (Builder $outer) use ($driver, $pk, $after) {
                foreach ($pk as $i => $column) {
                    $outer->orWhere(function (Builder $branch) use ($driver, $pk, $after, $i, $column) {
                        for ($j = 0; $j < $i; $j++) {
                            $branch->whereRaw($driver->quoteIdentifier($pk[$j]).' = ?', [$after[$j]]);
                        }
                        $branch->whereRaw($driver->quoteIdentifier($column).' > ?', [$after[$i]]);
                    });
                }
            });
        }
        foreach ($pk as $column) {
            $query->orderByRaw($driver->quoteIdentifier($column).' ASC');
        }
        $query->limit($dir === 'out' ? 1 : $limit + 1);

        try {
            $found = $query->get()->all();
        } catch (QueryException $e) {
            // An out-of-range source value or cursor value cannot match any value in the column: nothing to return.
            if ($this->isDataException($e)) {
                return $empty;
            }
            throw $e;
        }

        $hasMore = $dir === 'in' && count($found) > $limit;
        $rows = [];
        $last = null;
        foreach (array_slice($found, 0, $dir === 'out' ? 1 : $limit) as $r) {
            $assoc = (array) $r;
            $canonical = [];
            foreach ($pk as $i => $name) {
                $value = CellValue::present($assoc[$tprefix.$i] ?? null, PHP_INT_MAX);
                $canonical[$name] = is_bool($value) ? ($value ? 'true' : 'false') : $value;
            }
            $display = [];
            foreach ($target['columns'] as $c) {
                $display[] = CellValue::present($assoc[$c['name']] ?? null, CellValue::MAX_CHARS);
            }
            $rows[] = ['key' => $canonical, 'values' => $display];
            $last = array_values($canonical);
        }

        return ['rows' => $rows, 'next_after' => $hasMore ? $last : null];
    }

    /**
     * A per-request alias prefix that no real column of the table starts with.
     *
     * @param  list<ColumnArray>  $columns
     */
    private function aliasPrefix(array $columns): string
    {
        $names = array_column($columns, 'name');
        do {
            $prefix = '__r'.bin2hex(random_bytes(4)).'_';
            $clash = array_filter($names, fn (string $n) => str_starts_with($n, $prefix)) !== [];
        } while ($clash);

        return $prefix;
    }

    /**
     * @param  SnapshotArray  $snapshot
     * @return list<string>
     */
    private function relationshipColumns(array $snapshot, string $table): array
    {
        $names = [];
        foreach ($snapshot['relationships'] as $rel) {
            if ($rel['from_table'] === $table) {
                array_push($names, ...$rel['from_columns']);
            }
            if ($rel['to_table'] === $table) {
                array_push($names, ...$rel['to_columns']);
            }
        }

        return $names;
    }

    /**
     * @param  list<string>  $columns
     * @param  list<mixed>  $values
     */
    public function where(Builder $query, Driver $driver, array $columns, array $values): Builder
    {
        foreach ($columns as $i => $column) {
            $query->whereRaw($driver->quoteIdentifier($column).' = ?', [$values[$i]]);
        }

        return $query;
    }

    /**
     * @param  SnapshotArray  $snapshot
     * @param  array<string, mixed>  $raw  the record's raw key and relationship column values
     * @return list<RelationSummary>
     */
    private function relationships(Connection $db, Driver $driver, array $snapshot, string $table, array $raw): array
    {
        $out = [];
        $counted = 0;
        $deadline = hrtime(true) + (int) ($this->countBudgetSeconds * 1e9);
        foreach ($snapshot['relationships'] as $rel) {
            if ($rel['from_table'] === $table) {
                $values = array_map(fn ($c) => $raw[$c] ?? null, $rel['from_columns']);
                $out[] = $this->summary($rel, 'out', $rel['to_table'], $rel['from_columns'], $rel['to_columns'], ! in_array(null, $values, true), null);
            }
            if ($rel['to_table'] === $table) {
                $values = array_map(fn ($c) => $raw[$c] ?? null, $rel['to_columns']);
                $count = null;
                if ($counted < self::MAX_COUNTED && hrtime(true) < $deadline && ! in_array(null, $values, true)) {
                    $count = $this->count($db, $driver, $rel['from_table'], $rel['from_columns'], $values);
                    $counted++;
                }
                $out[] = $this->summary($rel, 'in', $rel['from_table'], $rel['from_columns'], $rel['to_columns'], true, $count);
            }
        }

        return $out;
    }

    /**
     * @param  RelationshipArray  $rel
     * @param  'in'|'out'  $direction
     * @param  list<string>  $columns
     * @param  list<string>  $otherColumns
     * @param  Count|null  $count
     * @return RelationSummary
     */
    private function summary(array $rel, string $direction, string $other, array $columns, array $otherColumns, bool $available, ?array $count): array
    {
        return [
            'id' => $rel['id'], 'direction' => $direction, 'table' => $other,
            'columns' => $columns, 'other_columns' => $otherColumns,
            'inferred' => $rel['inferred'], 'available' => $available, 'count' => $count,
        ];
    }

    /**
     * @param  list<string>  $childColumns
     * @param  list<mixed>  $values
     * @return Count|null null when the count could not be taken (the card shows it as unknown)
     */
    private function count(Connection $db, Driver $driver, string $childTable, array $childColumns, array $values): ?array
    {
        $inner = $this->where($db->table($db->raw($driver->quoteIdentifier($childTable)))->selectRaw('1'), $driver, $childColumns, $values)
            ->limit(self::COUNT_CAP + 1);
        try {
            $n = (int) $db->query()->fromSub($inner, 'capped')->count();
        } catch (QueryException $e) {
            // An out-of-range value cannot equal any value in the child column, so nothing references it.
            if ($this->isDataException($e)) {
                return ['value' => 0, 'capped' => false];
            }

            // Any other failure (permissions, a stale snapshot, a timeout) only loses the count, never the record.
            return null;
        }

        return $n > self::COUNT_CAP ? ['value' => self::COUNT_CAP, 'capped' => true] : ['value' => $n, 'capped' => false];
    }

    private function isDataException(QueryException $e): bool
    {
        return str_starts_with((string) ($e->errorInfo[0] ?? ''), '22');
    }
}
