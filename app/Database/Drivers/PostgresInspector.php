<?php

namespace App\Database\Drivers;

use App\Database\Schema\LaravelSchemaInspector;
use App\Database\Schema\RowCount;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;

class PostgresInspector extends LaravelSchemaInspector
{
    protected function schema(Connection $db, SavedConnection $saved): string
    {
        return ($saved->options ?? [])['schema'] ?? 'public';
    }

    protected function rowCounts(Connection $db, string $schema, array $tables): array
    {
        $rows = $db->select(
            "select c.relname as name, c.reltuples::bigint as row_count from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = ? and c.relkind in ('r', 'p')",
            [$schema],
        );

        $counts = [];
        foreach ($rows as $row) {
            // reltuples is -1 for tables that have never been analyzed.
            $counts[$row->name] = (int) $row->row_count < 0 ? RowCount::unknown() : new RowCount((int) $row->row_count, 'estimate');
        }

        return $counts;
    }
}
