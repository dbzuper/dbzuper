<?php

namespace App\Database\Query;

use App\Database\Contracts\Driver;
use Illuminate\Database\Connection;

final class TableCountQuery
{
    /**
     * @param  array{name: string, columns: list<array{name: string, type_name: string}>}  $table
     * @param  list<array{column: string, op: string, value?: ?string, to?: ?string}>  $filters
     */
    public static function run(Connection $db, Driver $driver, array $table, array $filters): int
    {
        $query = $db->table($db->raw($driver->quoteIdentifier($table['name'])));
        TableRowsQuery::applyFilters($query, $db, $driver, $filters, false, $table['columns']);

        return (int) $query->count();
    }
}
