<?php

namespace App\Database\Query;

use App\Database\CellValue;
use App\Database\Contracts\Driver;
use Illuminate\Database\Connection;
use Illuminate\Database\Query\Builder;

final class TableRowsQuery
{
    public const OPS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains', 'starts_with', 'ends_with', 'is_null', 'is_not_null'];

    private const COMPARE = ['eq' => '=', 'neq' => '<>', 'lt' => '<', 'lte' => '<=', 'gt' => '>', 'gte' => '>='];

    /**
     * @param  array{name: string, columns: list<array{name: string, type_name: string, type: string}>}  $table
     * @param  list<array{column: string, op: string, value?: ?string}>  $filters
     * @param  ?array{column: string, direction: string}  $sort
     * @return array{columns: list<array{name:string,type:?string,table:string}>, rows: list<list<mixed>>, has_more: bool, sql: string}
     */
    public static function run(Connection $db, Driver $driver, array $table, array $filters, ?array $sort, int $page, int $perPage): array
    {
        $q = fn (string $name) => $driver->quoteIdentifier($name);
        $query = $db->table($db->raw($q($table['name'])))
            ->select(array_map(
                fn ($c) => $driver->sampleColumn($db, $c['name'], strtolower((string) ($c['type_name'] ?? '')), CellValue::RESULT_CHARS),
                $table['columns'],
            ));

        foreach ($filters as $f) {
            self::apply($query, $driver, $q($f['column']), $f['op'], $f['value'] ?? null);
        }
        if ($sort) {
            $query->orderByRaw($q($sort['column']).' '.($sort['direction'] === 'desc' ? 'desc' : 'asc'));
        }
        $query->offset(($page - 1) * $perPage)->limit($perPage + 1);

        $sql = $query->toRawSql();
        $rows = array_map(
            fn ($row) => array_map(fn ($v) => CellValue::present($v, CellValue::RESULT_CHARS), array_values((array) $row)),
            $query->get()->all(),
        );
        $more = count($rows) > $perPage;

        return [
            'columns' => array_map(fn ($c) => ['name' => $c['name'], 'type' => $c['type'], 'table' => $table['name']], $table['columns']),
            'rows' => array_slice($rows, 0, $perPage),
            'has_more' => $more,
            'sql' => $sql,
        ];
    }

    private static function apply(Builder $query, Driver $driver, string $column, string $op, ?string $value): void
    {
        if ($op === 'is_null' || $op === 'is_not_null') {
            $query->whereRaw($column.($op === 'is_null' ? ' IS NULL' : ' IS NOT NULL'));

            return;
        }
        if (isset(self::COMPARE[$op])) {
            $query->whereRaw($column.' '.self::COMPARE[$op].' ?', [$value ?? '']);

            return;
        }
        $escaped = str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $value ?? '');
        $pattern = match ($op) {
            'contains' => "%{$escaped}%",
            'starts_with' => "{$escaped}%",
            'ends_with' => "%{$escaped}",
        };
        $query->whereRaw($driver->likeColumn($column)." LIKE ? ESCAPE '!'", [$pattern]);
    }
}
