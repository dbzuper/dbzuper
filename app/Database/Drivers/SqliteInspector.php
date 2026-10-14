<?php

namespace App\Database\Drivers;

use App\Database\Schema\LaravelSchemaInspector;
use App\Database\Schema\RowCount;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;

class SqliteInspector extends LaravelSchemaInspector
{
    protected function schema(Connection $db, SavedConnection $saved): string
    {
        return 'main';
    }

    protected function includeTable(string $name): bool
    {
        return ! str_starts_with($name, 'sqlite_');
    }

    protected function rowCounts(Connection $db, string $schema, array $tables): array
    {
        $cap = (int) config('dbsuperb.sqlite_count_cap');
        $grammar = $db->getQueryGrammar();

        $counts = [];
        foreach ($tables as $table) {
            $count = (int) $db->selectOne(
                'select count(*) as c from (select 1 from '.$grammar->wrapTable($table).' limit '.($cap + 1).') t'
            )->c;
            $counts[$table] = $count > $cap ? new RowCount($cap, 'at_least') : new RowCount($count, 'exact');
        }

        return $counts;
    }
}
