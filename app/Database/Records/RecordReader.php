<?php

namespace App\Database\Records;

use App\Database\CellValue;
use App\Database\Contracts\Driver;
use Illuminate\Database\Connection;
use Illuminate\Database\Query\Builder;

final class RecordReader
{
    public const COUNT_CAP = 10000;

    public const MAX_COUNTED = 12;

    /** @return array{table:string,key:array,columns:list<array{name:string,type:string}>,values:list<mixed>,relationships:list<array>}|null */
    public function read(Connection $db, Driver $driver, array $snapshot, array $table, RecordKey $key): ?array
    {
        $row = $this->where($db->table($db->raw($driver->quoteIdentifier($table['name']))), $driver, $key->columns(), $key->values())
            ->select(array_map(fn ($c) => $driver->sampleColumn($db, $c['name'], strtolower((string) ($c['type_name'] ?? '')), CellValue::RESULT_CHARS), $table['columns']))
            ->first();
        if ($row === null) {
            return null;
        }
        $assoc = (array) $row;
        $raw = [];
        foreach ($table['columns'] as $c) {
            $raw[$c['name']] = $assoc[$c['name']] ?? null;
        }

        return [
            'table' => $table['name'],
            'key' => $key->toArray(),
            'columns' => array_map(fn ($c) => ['name' => $c['name'], 'type' => $c['type']], $table['columns']),
            'values' => array_map(fn ($v) => CellValue::present($v, CellValue::RESULT_CHARS), array_values($raw)),
            'relationships' => $this->relationships($db, $driver, $snapshot, $table['name'], $raw),
        ];
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
        $n = (int) $db->query()->fromSub($inner, 'capped')->count();

        return $n > self::COUNT_CAP ? ['value' => self::COUNT_CAP, 'capped' => true] : ['value' => $n, 'capped' => false];
    }
}
