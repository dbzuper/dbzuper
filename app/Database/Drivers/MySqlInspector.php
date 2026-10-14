<?php

namespace App\Database\Drivers;

use App\Database\Schema\LaravelSchemaInspector;
use App\Database\Schema\RowCount;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;

class MySqlInspector extends LaravelSchemaInspector
{
    protected function schema(Connection $db, SavedConnection $saved): string
    {
        return $saved->database;
    }

    protected function rowCounts(Connection $db, string $schema, array $tables): array
    {
        $rows = $db->select(
            "select table_name as name, table_rows as row_count from information_schema.tables where table_schema = ? and table_type = 'BASE TABLE'",
            [$schema],
        );

        $counts = [];
        foreach ($rows as $row) {
            $counts[$row->name] = $row->row_count === null ? RowCount::unknown() : new RowCount((int) $row->row_count, 'estimate');
        }

        return $counts;
    }
}
