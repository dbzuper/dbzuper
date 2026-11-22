<?php

namespace App\Transfers\Export;

use App\Enums\DriverName;
use Illuminate\Database\Connection;

final class ObjectLister
{
    /** @return list<DumpObject> */
    public static function list(Connection $db, DriverName $driver): array
    {
        return match ($driver) {
            DriverName::MySql, DriverName::MariaDb => self::mysql($db),
            DriverName::Postgres => self::postgres($db),
            DriverName::Sqlite => self::sqlite($db),
        };
    }

    /** @return list<DumpObject> */
    private static function mysql(Connection $db): array
    {
        $rows = $db->select(
            'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE IN (\'BASE TABLE\', \'SYSTEM VERSIONED\', \'VIEW\') ORDER BY TABLE_NAME',
        );

        return array_values(array_map(
            fn ($r) => new DumpObject(null, (string) $r->name, $r->type === 'VIEW' ? 'view' : 'table'),
            $rows,
        ));
    }

    /** @return list<DumpObject> */
    private static function postgres(Connection $db): array
    {
        $rows = $db->select(
            "SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind IN ('r', 'p', 'v')
               AND n.nspname NOT IN ('pg_catalog', 'information_schema')
               AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'
               AND NOT c.relispartition
             ORDER BY n.nspname, c.relname",
        );

        return array_values(array_map(
            fn ($r) => new DumpObject((string) $r->schema, (string) $r->name, $r->kind === 'v' ? 'view' : 'table'),
            $rows,
        ));
    }

    /** @return list<DumpObject> */
    private static function sqlite(Connection $db): array
    {
        $rows = $db->select(
            "SELECT name, type FROM sqlite_master
             WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name",
        );

        return array_values(array_map(
            fn ($r) => new DumpObject(null, (string) $r->name, $r->type === 'view' ? 'view' : 'table'),
            $rows,
        ));
    }
}
