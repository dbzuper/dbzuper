<?php

namespace App\Database\Editing;

use App\Database\ColumnKind;
use App\Database\Schema\TableInfo;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use LogicException;
use Throwable;

/** Decides per table how a row is pinned for UPDATE/DELETE (spec §5) and which columns can never be edited. */
/** @phpstan-import-type TableArray from TableInfo */
final class EditMethodResolver
{
    /** SQLite names for the rowid; a column with the same name hides it. */
    public const SQLITE_ROWID_ALIASES = ['rowid', '_rowid_', 'oid'];

    /** Why a read-only connection's tables can't be edited. */
    public const READ_ONLY_REASON = 'this connection is read-only';

    /**
     * The SQLite rowid name a statement uses: the first alias no column shadows (rows and change sets agree).
     *
     * @param  list<string>  $names  the table's column names
     */
    public static function sqliteRowidAlias(array $names): string
    {
        $taken = array_map('strtolower', $names);
        foreach (self::SQLITE_ROWID_ALIASES as $alias) {
            if (! in_array($alias, $taken, true)) {
                return $alias;
            }
        }

        throw new LogicException('Every SQLite rowid alias is hidden by a column.');
    }

    /** @param TableArray $table */
    public function resolve(SavedConnection $connection, array $table, Connection $db): EditPlan
    {
        if ($table['kind'] !== 'table') {
            return EditPlan::none("views can't be edited");
        }
        if ($connection->read_only) {
            return EditPlan::none(self::READ_ONLY_REASON);
        }

        $driver = $connection->driver;
        $name = (string) $table['name'];
        $readOnly = $this->readOnlyColumns($table, $this->generatedColumns($driver, $db, $connection, $name));
        $nonComparable = $driver === DriverName::Postgres ? $this->pgNonComparableColumns($db, $connection, $name) : [];

        // A MySQL/MariaDB TIMESTAMP is shown in the session time zone, where a DST fall-back hour shows two stored
        // instants as the same text: a key holding one could pin the other row, so such a key is passed over.
        $timestamps = in_array($driver, [DriverName::MySql, DriverName::MariaDb], true) ? $this->timestampColumns($table) : [];

        $pk = $table['primary_key'];
        if ($pk !== [] && array_intersect($pk, $timestamps) === []) {
            return self::plan(EditMethod::PrimaryKey, $readOnly, $nonComparable, $pk);
        }

        $unique = $this->uniqueNotNullIndex($table, $this->unusableIndexes($driver, $db, $connection, $name), $timestamps);
        if ($unique !== null) {
            return self::plan(EditMethod::UniqueIndex, $readOnly, $nonComparable, $unique);
        }

        return match ($driver) {
            DriverName::Sqlite => match (true) {
                $this->sqliteWithoutRowid($db, $name) => EditPlan::none('this table has no primary key or unique index to identify rows'),
                ! $this->sqliteRowidReachable($table) => EditPlan::none('columns named rowid, _rowid_ and oid hide the SQLite row id'),
                default => self::plan(EditMethod::SqliteRowid, $readOnly, $nonComparable),
            },
            DriverName::Postgres => self::plan(EditMethod::PgCtid, $readOnly, $nonComparable, tableoid: $this->pgNeedsTableoid($db, $connection, $name)),
            DriverName::MySql, DriverName::MariaDb => self::plan(EditMethod::MysqlAllValues, $readOnly, $nonComparable),
        };
    }

    /**
     * @param  list<string>  $readOnly
     * @param  list<string>  $nonComparable
     * @param  list<string>  $keys
     */
    private static function plan(EditMethod $method, array $readOnly, array $nonComparable, array $keys = [], bool $tableoid = false): EditPlan
    {
        return new EditPlan($method, $keys, null, $readOnly, $tableoid, $nonComparable);
    }

    /**
     * The first unique index (by name) whose columns all exist and are NOT NULL.
     *
     * @param  TableArray  $table
     * @param  list<string>  $partial  index names that can't pin a row (partial, expression, invalid, deferrable)
     * @param  list<string>  $excluded  columns that can't be part of a key (MySQL/MariaDB TIMESTAMP)
     * @return ?list<string>
     */
    private function uniqueNotNullIndex(array $table, array $partial, array $excluded = []): ?array
    {
        $nullable = [];
        foreach ($table['columns'] as $column) {
            $nullable[$column['name']] = $column['nullable'];
        }

        $candidates = array_values(array_filter($table['indexes'], function (array $index) use ($nullable, $partial, $excluded) {
            if (! $index['unique'] || $index['primary'] || in_array($index['name'], $partial, true)) {
                return false;
            }
            $columns = $index['columns'];
            if ($columns === []) {
                return false;
            }
            foreach ($columns as $column) {
                // Expression parts come back empty or unnamed, so they match no column; they can't be bound as a key.
                if (! array_key_exists($column, $nullable) || $nullable[$column] || in_array($column, $excluded, true)) {
                    return false;
                }
            }

            return true;
        }));
        usort($candidates, fn (array $a, array $b) => strcmp($a['name'], $b['name']));

        return $candidates === [] ? null : $candidates[0]['columns'];
    }

    /**
     * @param  TableArray  $table
     * @return list<string> columns of type TIMESTAMP
     */
    private function timestampColumns(array $table): array
    {
        $out = [];
        foreach ($table['columns'] as $column) {
            if (preg_match('/^timestamp(\(\d\))?$/i', trim($column['type_name']))) {
                $out[] = $column['name'];
            }
        }

        return $out;
    }

    /**
     * @param  TableArray  $table
     * @param  list<string>  $generated
     * @return list<string>
     */
    private function readOnlyColumns(array $table, array $generated): array
    {
        $out = [];
        foreach ($table['columns'] as $column) {
            if (in_array($column['name'], $generated, true)
                || ColumnKind::classify($column['type_name']) === ColumnKind::Binary) {
                $out[] = $column['name'];
            }
        }

        return $out;
    }

    /** @return list<string> generated/computed columns, plus identity ALWAYS columns on PostgreSQL */
    private function generatedColumns(DriverName $driver, Connection $db, SavedConnection $saved, string $table): array
    {
        $rows = match ($driver) {
            DriverName::Sqlite => $db->select('select name from pragma_table_xinfo(?) where hidden in (2, 3)', [$table]),
            DriverName::MySql, DriverName::MariaDb => $db->select(
                'select column_name as name from information_schema.columns where table_schema = ? and table_name = ? '
                ."and (upper(extra) like '%VIRTUAL GENERATED%' or upper(extra) like '%STORED GENERATED%' or upper(extra) like '%PERSISTENT GENERATED%')",
                [$db->getDatabaseName(), $table],
            ),
            DriverName::Postgres => $db->select(
                'select a.attname as name from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace '
                .'where n.nspname = ? and c.relname = ? and a.attnum > 0 and not a.attisdropped and ('
                .(version_compare((string) $db->getServerVersion(), '12.0', '>=') ? "a.attgenerated <> '' or " : '')
                ."a.attidentity = 'a')",
                [$this->pgSchema($saved), $table],
            ),
        };

        return array_map(fn (mixed $name) => (string) $name, array_column($rows, 'name'));
    }

    /**
     * Unique indexes that can't pin a row: partial (cover only some rows), with an expression key part (the
     * snapshot drops those parts, so the plain columns alone would look unique), and on PostgreSQL invalid,
     * not-ready or deferrable ones.
     *
     * @return list<string>
     */
    private function unusableIndexes(DriverName $driver, Connection $db, SavedConnection $saved, string $table): array
    {
        if ($driver === DriverName::MySql || $driver === DriverName::MariaDb) {
            // select * so servers without the EXPRESSION column (MariaDB, MySQL < 8.0.13) still work.
            $out = [];
            foreach ($db->select('select * from information_schema.statistics where table_schema = ? and table_name = ?', [$db->getDatabaseName(), $table]) as $row) {
                $row = array_change_key_case((array) $row, CASE_UPPER);
                if (($row['COLUMN_NAME'] ?? null) === null || ($row['EXPRESSION'] ?? null) !== null) {
                    $out[] = (string) $row['INDEX_NAME'];
                }
            }

            return array_values(array_unique($out));
        }

        $rows = match ($driver) {
            DriverName::Sqlite => $db->select(
                'select il.name from pragma_index_list(?) il where il.partial = 1 '
                .'or exists (select 1 from pragma_index_info(il.name) ii where ii.cid = -2 or ii.name is null)',
                [$table],
            ),
            DriverName::Postgres => $db->select(
                'select ic.relname as name from pg_index i join pg_class tc on tc.oid = i.indrelid '
                .'join pg_namespace n on n.oid = tc.relnamespace join pg_class ic on ic.oid = i.indexrelid '
                .'where n.nspname = ? and tc.relname = ? and (i.indpred is not null or i.indexprs is not null '
                .'or not i.indisvalid or not i.indisready or not i.indimmediate)',
                [$this->pgSchema($saved), $table],
            ),
        };

        return array_map(fn (mixed $name) => (string) $name, array_column($rows, 'name'));
    }

    /**
     * Columns whose type has no default btree operator class, so `col = ?` fails (jsonpath, txid_snapshot,
     * pg_snapshot, json, xml, geometric and many extension types). Domains resolve to their base type and arrays to
     * their element type (array `=` compares elements); a type matches an operator class on its own type, a
     * binary-coercible one (varchar → text) or the polymorphic enum and range classes. Composite types are left out:
     * record `=` fails at run time when any field can't be compared.
     *
     * @return list<string> in column order
     */
    private function pgNonComparableColumns(Connection $db, SavedConnection $saved, string $table): array
    {
        $sql = <<<'SQL'
            with recursive col as (
                select a.attname as name, a.attnum as num, a.atttypid as typ, 0 as depth
                from pg_attribute a
                join pg_class c on c.oid = a.attrelid
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = ? and c.relname = ? and a.attnum > 0 and not a.attisdropped
                union all
                select col.name, col.num, case when t.typtype = 'd' then t.typbasetype else t.typelem end, col.depth + 1
                from col join pg_type t on t.oid = col.typ
                where col.depth < 16 and (t.typtype = 'd' or (t.typcategory = 'A' and t.typelem <> 0))
            ), base as (
                select distinct on (num) name, num, typ from col order by num, depth desc
            )
            select base.name from base join pg_type t on t.oid = base.typ
            where not exists (
                select 1 from pg_opclass oc
                join pg_am am on am.oid = oc.opcmethod
                join pg_type it on it.oid = oc.opcintype
                where am.amname = 'btree' and oc.opcdefault and (
                    oc.opcintype = base.typ
                    or exists (select 1 from pg_cast k where k.castsource = base.typ and k.casttarget = oc.opcintype and k.castmethod = 'b')
                    or (it.typname = 'anyenum' and t.typtype = 'e')
                    or (it.typname = 'anyrange' and t.typtype = 'r')
                    or (it.typname = 'anymultirange' and t.typtype = 'm')
                )
            )
            order by base.num
            SQL;
        $rows = $db->select(
            $sql,
            [$this->pgSchema($saved), $table],
        );

        return array_map(fn (mixed $name) => (string) $name, array_column($rows, 'name'));
    }

    /** ctid is unique only per physical relation: a partitioned table or an inheritance parent also needs tableoid. */
    private function pgNeedsTableoid(Connection $db, SavedConnection $saved, string $table): bool
    {
        $row = $db->select(
            "select (c.relkind = 'p' or exists (select 1 from pg_inherits i where i.inhparent = c.oid)) as needs "
            .'from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = ? and c.relname = ?',
            [$this->pgSchema($saved), $table],
        )[0] ?? null;

        return (bool) ($row->needs ?? false);
    }

    private function sqliteWithoutRowid(Connection $db, string $table): bool
    {
        try {
            $row = $db->select("select wr from pragma_table_list where schema = 'main' and name = ?", [$table])[0] ?? null;
            if ($row !== null) {
                return (bool) $row->wr;
            }
        } catch (Throwable) {
            // pragma_table_list needs SQLite 3.37+; fall back to the CREATE statement.
        }

        $sql = (string) ($db->select("select sql from sqlite_master where type = 'table' and name = ?", [$table])[0]->sql ?? '');

        return (bool) preg_match('/\)\s*(?:strict\s*,\s*)?without\s+rowid(?:\s*,\s*strict)?\s*;?\s*$/i', $sql);
    }

    /** @param TableArray $table */
    private function sqliteRowidReachable(array $table): bool
    {
        $names = array_map(fn (array $c) => strtolower($c['name']), $table['columns']);

        return array_diff(self::SQLITE_ROWID_ALIASES, $names) !== [];
    }

    private function pgSchema(SavedConnection $saved): string
    {
        return ($saved->options ?? [])['schema'] ?? 'public';
    }
}
