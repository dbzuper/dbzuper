<?php

namespace App\Database\Editing;

use App\Database\ColumnKind;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use LogicException;
use Throwable;

/** Decides per table how a row is pinned for UPDATE/DELETE (spec §5) and which columns can never be edited. */
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

    /** @param array{name: string, kind: string, columns: list<array>, primary_key: list<string>, indexes: list<array>} $table */
    public function resolve(SavedConnection $connection, array $table, Connection $db): EditPlan
    {
        if (($table['kind'] ?? 'table') !== 'table') {
            return EditPlan::none("views can't be edited");
        }
        if ($connection->read_only) {
            return EditPlan::none(self::READ_ONLY_REASON);
        }

        $driver = $connection->driver;
        $name = (string) $table['name'];
        $readOnly = $this->readOnlyColumns($table, $this->generatedColumns($driver, $db, $connection, $name));
        $plan = fn (EditMethod $method, array $keys = []) => new EditPlan($method, $keys, null, $readOnly);

        $pk = array_values($table['primary_key'] ?? []);
        if ($pk !== []) {
            return $plan(EditMethod::PrimaryKey, $pk);
        }

        $unique = $this->uniqueNotNullIndex($table, $this->unusableIndexes($driver, $db, $connection, $name));
        if ($unique !== null) {
            return $plan(EditMethod::UniqueIndex, $unique);
        }

        return match ($driver) {
            DriverName::Sqlite => match (true) {
                $this->sqliteWithoutRowid($db, $name) => EditPlan::none('this table has no primary key or unique index to identify rows'),
                ! $this->sqliteRowidReachable($table) => EditPlan::none('columns named rowid, _rowid_ and oid hide the SQLite row id'),
                default => $plan(EditMethod::SqliteRowid),
            },
            DriverName::Postgres => new EditPlan(EditMethod::PgCtid, [], null, $readOnly, $this->pgNeedsTableoid($db, $connection, $name)),
            DriverName::MySql, DriverName::MariaDb => $plan(EditMethod::MysqlAllValues),
        };
    }

    /**
     * The first unique index (by name) whose columns all exist and are NOT NULL.
     *
     * @param  list<string>  $partial  index names that can't pin a row (partial, expression, invalid, deferrable)
     * @return ?list<string>
     */
    private function uniqueNotNullIndex(array $table, array $partial): ?array
    {
        $nullable = [];
        foreach ($table['columns'] ?? [] as $column) {
            $nullable[$column['name']] = (bool) $column['nullable'];
        }

        $candidates = array_values(array_filter($table['indexes'] ?? [], function (array $index) use ($nullable, $partial) {
            if (! ($index['unique'] ?? false) || ($index['primary'] ?? false) || in_array($index['name'], $partial, true)) {
                return false;
            }
            $columns = $index['columns'] ?? [];
            if ($columns === []) {
                return false;
            }
            foreach ($columns as $column) {
                // Expression parts come back empty or unnamed; they can't be bound as a key.
                if (! is_string($column) || ! array_key_exists($column, $nullable) || $nullable[$column]) {
                    return false;
                }
            }

            return true;
        }));
        usort($candidates, fn (array $a, array $b) => strcmp((string) $a['name'], (string) $b['name']));

        return $candidates === [] ? null : array_values($candidates[0]['columns']);
    }

    /**
     * @param  list<string>  $generated
     * @return list<string>
     */
    private function readOnlyColumns(array $table, array $generated): array
    {
        $out = [];
        foreach ($table['columns'] ?? [] as $column) {
            if (in_array($column['name'], $generated, true)
                || ColumnKind::classify((string) ($column['type_name'] ?? $column['type'] ?? '')) === ColumnKind::Binary) {
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

        return array_map(fn (object $r) => (string) $r->name, $rows);
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

        return array_map(fn (object $r) => (string) $r->name, $rows);
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

    private function sqliteRowidReachable(array $table): bool
    {
        $names = array_map(fn (array $c) => strtolower((string) $c['name']), $table['columns'] ?? []);

        return array_diff(self::SQLITE_ROWID_ALIASES, $names) !== [];
    }

    private function pgSchema(SavedConnection $saved): string
    {
        return ($saved->options ?? [])['schema'] ?? 'public';
    }
}
