<?php

namespace App\Database\Editing;

/** How UPDATE/DELETE statements pin exactly one row of a table (spec §5). */
enum EditMethod: string
{
    case PrimaryKey = 'primary_key';
    case UniqueIndex = 'unique_index';
    case SqliteRowid = 'sqlite_rowid';
    case PgCtid = 'pg_ctid';
    case MysqlAllValues = 'mysql_all_values';
    case None = 'none';
}
