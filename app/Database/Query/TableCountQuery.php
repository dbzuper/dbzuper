<?php

namespace App\Database\Query;

use App\Database\Contracts\Driver;
use Illuminate\Database\Connection;

final class TableCountQuery
{
    /**
     * @param  array{name: string}  $table
     * @param  list<array{column: string, op: string, value?: ?string}>  $filters
     */
    public static function run(Connection $db, Driver $driver, array $table, array $filters): int
    {
        $query = $db->table($db->raw($driver->quoteIdentifier($table['name'])));
        TableRowsQuery::applyFilters($query, $db, $driver, $filters, false);

        return (int) $query->count();
    }
}
