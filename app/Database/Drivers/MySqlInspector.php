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

    /** MySQL/MariaDB may report the referenced database name in a different case (e.g. lower_case_table_names). */
    protected function sameSchema(?string $foreign, string $schema): bool
    {
        return $foreign === null || strcasecmp($foreign, $schema) === 0;
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

    protected function describe(Connection $db, string $schema, array $tableNames, array $viewNames): array
    {
        $processor = $db->getPostProcessor();

        $columns = $db->select(
            'select table_name as `table_name`, column_name as `name`, data_type as `type_name`, column_type as `type`, '
            .'collation_name as `collation`, is_nullable as `nullable`, column_default as `default`, '
            .'column_comment as `comment`, generation_expression as `expression`, extra as `extra` '
            .'from information_schema.columns where table_schema = ? '
            .'order by table_name, ordinal_position',
            [$schema],
        );

        $indexes = $db->select(
            'select table_name as `table_name`, index_name as `name`, '
            .'group_concat(column_name order by seq_in_index) as `columns`, '
            .'index_type as `type`, not non_unique as `unique` '
            .'from information_schema.statistics where table_schema = ? '
            .'group by table_name, index_name, index_type, non_unique',
            [$schema],
        );

        $foreignKeys = $db->select(
            'select kc.table_name as `table_name`, kc.constraint_name as `name`, '
            .'group_concat(kc.column_name order by kc.ordinal_position) as `columns`, '
            .'kc.referenced_table_schema as `foreign_schema`, kc.referenced_table_name as `foreign_table`, '
            .'group_concat(kc.referenced_column_name order by kc.ordinal_position) as `foreign_columns`, '
            .'rc.update_rule as `on_update`, rc.delete_rule as `on_delete` '
            .'from information_schema.key_column_usage kc join information_schema.referential_constraints rc '
            .'on kc.constraint_schema = rc.constraint_schema and kc.constraint_name = rc.constraint_name '
            .'where kc.table_schema = ? and kc.referenced_table_name is not null '
            .'group by kc.table_name, kc.constraint_name, kc.referenced_table_schema, kc.referenced_table_name, rc.update_rule, rc.delete_rule',
            [$schema],
        );

        return [
            'columns' => $this->groupByTable($columns, fn (array $rows) => $processor->processColumns($rows)),
            'indexes' => $this->groupByTable($indexes, fn (array $rows) => $processor->processIndexes($rows)),
            'foreignKeys' => $this->groupByTable($foreignKeys, fn (array $rows) => $processor->processForeignKeys($rows)),
        ];
    }
}
