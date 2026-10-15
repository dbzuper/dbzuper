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

    protected function describe(Connection $db, string $schema, array $tableNames, array $viewNames): array
    {
        if (version_compare((string) $db->getServerVersion(), '12.0', '<')) {
            return parent::describe($db, $schema, $tableNames, $viewNames);
        }

        $processor = $db->getPostProcessor();

        $columns = $db->select(
            'select c.relname as table_name, a.attname as name, t.typname as type_name, '
            .'format_type(a.atttypid, a.atttypmod) as type, '
            .'(select tc.collcollate from pg_catalog.pg_collation tc where tc.oid = a.attcollation) as collation, '
            .'not a.attnotnull as nullable, '
            .'(select pg_get_expr(adbin, adrelid) from pg_attrdef where c.oid = pg_attrdef.adrelid and pg_attrdef.adnum = a.attnum) as default, '
            .'a.attgenerated as generated, col_description(c.oid, a.attnum) as comment '
            .'from pg_attribute a, pg_class c, pg_type t, pg_namespace n '
            ."where n.nspname = ? and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped "
            .'and a.attrelid = c.oid and a.atttypid = t.oid and n.oid = c.relnamespace '
            .'order by c.relname, a.attnum',
            [$schema],
        );

        $indexes = $db->select(
            "select tc.relname as table_name, ic.relname as name, string_agg(a.attname, ',' order by indseq.ord) as columns, "
            .'am.amname as "type", i.indisunique as "unique", i.indisprimary as "primary" '
            .'from pg_index i '
            .'join pg_class tc on tc.oid = i.indrelid '
            .'join pg_namespace tn on tn.oid = tc.relnamespace '
            .'join pg_class ic on ic.oid = i.indexrelid '
            .'join pg_am am on am.oid = ic.relam '
            .'join lateral unnest(i.indkey) with ordinality as indseq(num, ord) on true '
            .'left join pg_attribute a on a.attrelid = i.indrelid and a.attnum = indseq.num '
            .'where tn.nspname = ? '
            .'group by tc.relname, ic.relname, am.amname, i.indisunique, i.indisprimary',
            [$schema],
        );

        $foreignKeys = $db->select(
            'select tc.relname as table_name, c.conname as name, '
            ."string_agg(la.attname, ',' order by conseq.ord) as columns, "
            .'fn.nspname as foreign_schema, fc.relname as foreign_table, '
            ."string_agg(fa.attname, ',' order by conseq.ord) as foreign_columns, "
            .'c.confupdtype as on_update, c.confdeltype as on_delete '
            .'from pg_constraint c '
            .'join pg_class tc on c.conrelid = tc.oid '
            .'join pg_namespace tn on tn.oid = tc.relnamespace '
            .'join pg_class fc on c.confrelid = fc.oid '
            .'join pg_namespace fn on fn.oid = fc.relnamespace '
            .'join lateral unnest(c.conkey) with ordinality as conseq(num, ord) on true '
            .'join pg_attribute la on la.attrelid = c.conrelid and la.attnum = conseq.num '
            .'join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = c.confkey[conseq.ord] '
            ."where c.contype = 'f' and tn.nspname = ? "
            .'group by tc.relname, c.conname, fn.nspname, fc.relname, c.confupdtype, c.confdeltype',
            [$schema],
        );

        return [
            'columns' => $this->groupByTable($columns, fn (array $rows) => $processor->processColumns($rows)),
            'indexes' => $this->groupByTable($indexes, fn (array $rows) => $processor->processIndexes($rows)),
            'foreignKeys' => $this->groupByTable($foreignKeys, fn (array $rows) => $processor->processForeignKeys($rows)),
        ];
    }
}
