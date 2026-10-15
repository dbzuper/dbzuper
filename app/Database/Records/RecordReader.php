<?php

namespace App\Database\Records;

use App\Database\CellValue;
use App\Database\Contracts\Driver;
use Illuminate\Database\Connection;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;

final class RecordReader
{
    public const COUNT_CAP = 10000;

    public const MAX_COUNTED = 12;

    /** @return array{table:string,key:array,columns:list<array{name:string,type:string}>,values:list<mixed>,relationships:list<array>}|null */
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
        $select = array_map(fn ($c) => $driver->sampleColumn($db, $c['name'], strtolower((string) ($c['type_name'] ?? '')), CellValue::RESULT_CHARS), $table['columns']);
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

    /** @return list<string> */
    private function relationshipColumns(array $snapshot, string $table): array
    {
        $names = [];
        foreach ($snapshot['relationships'] ?? [] as $rel) {
            if ($rel['from_table'] === $table) {
                array_push($names, ...$rel['from_columns']);
            }
            if ($rel['to_table'] === $table) {
                array_push($names, ...$rel['to_columns']);
            }
        }

        return $names;
    }

    /** @param list<string> $columns @param list<mixed> $values */
    public function where(Builder $query, Driver $driver, array $columns, array $values): Builder
    {
        foreach ($columns as $i => $column) {
            $query->whereRaw($driver->quoteIdentifier($column).' = ?', [$values[$i]]);
        }

        return $query;
    }

    private function relationships(Connection $db, Driver $driver, array $snapshot, string $table, array $raw): array
    {
        $out = [];
        $counted = 0;
        foreach ($snapshot['relationships'] ?? [] as $rel) {
            if ($rel['from_table'] === $table) {
                $values = array_map(fn ($c) => $raw[$c] ?? null, $rel['from_columns']);
                $out[] = $this->summary($rel, 'out', $rel['to_table'], $rel['from_columns'], $rel['to_columns'], ! in_array(null, $values, true), null);
            }
            if ($rel['to_table'] === $table) {
                $values = array_map(fn ($c) => $raw[$c] ?? null, $rel['to_columns']);
                $count = null;
                if ($counted < self::MAX_COUNTED && ! in_array(null, $values, true)) {
                    $count = $this->count($db, $driver, $rel['from_table'], $rel['from_columns'], $values);
                    $counted++;
                }
                $out[] = $this->summary($rel, 'in', $rel['from_table'], $rel['from_columns'], $rel['to_columns'], true, $count);
            }
        }

        return $out;
    }

    private function summary(array $rel, string $direction, string $other, array $columns, array $otherColumns, bool $available, ?array $count): array
    {
        return [
            'id' => $rel['id'], 'direction' => $direction, 'table' => $other,
            'columns' => $columns, 'other_columns' => $otherColumns,
            'inferred' => (bool) ($rel['inferred'] ?? false), 'available' => $available, 'count' => $count,
        ];
    }

    /** @return array{value:int,capped:bool} */
    private function count(Connection $db, Driver $driver, string $childTable, array $childColumns, array $values): array
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
            throw $e;
        }

        return $n > self::COUNT_CAP ? ['value' => self::COUNT_CAP, 'capped' => true] : ['value' => $n, 'capped' => false];
    }

    private function isDataException(QueryException $e): bool
    {
        return str_starts_with((string) ($e->errorInfo[0] ?? ''), '22');
    }
}
