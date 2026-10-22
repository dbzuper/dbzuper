<?php

namespace App\Database\Editing;

use App\Database\ColumnKind;
use App\Enums\DriverName;

/**
 * Whether a column's original value can be matched reliably with `=` (spec §5.1). Columns that can't are left out
 * of optimistic and ctid value checks, and make a row read-only under the MySQL/MariaDB all-values method.
 */
final class ColumnComparability
{
    private const FLOAT = '/^(float\d*|real|double( precision)?|binary_float|binary_double)$/';

    /** PostgreSQL types without an `=` operator (or whose text form doesn't round-trip through `=`). */
    private const PG_NO_EQUALITY = ['json', 'xml', 'point', 'line', 'lseg', 'box', 'path', 'polygon', 'circle'];

    /**
     * MySQL/MariaDB types compared exactly: integer, decimal, date-time and text. Text is only exact when compared
     * byte for byte through a BINARY/varbinary cast: even utf8mb4_bin is PAD SPACE ('a' = 'a ').
     */
    private const MYSQL_EXACT = [
        'tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint',
        'decimal', 'numeric', 'dec', 'fixed',
        'date', 'datetime', 'timestamp', 'time', 'year',
        'char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum',
    ];

    /** @param array{type_name?: string, type?: string} $column */
    public static function exact(DriverName $driver, array $column): bool
    {
        $type = strtolower(trim((string) ($column['type_name'] ?? $column['type'] ?? '')));

        if (ColumnKind::classify($type) === ColumnKind::Binary) {
            return false;
        }

        return match ($driver) {
            DriverName::MySql, DriverName::MariaDb => in_array(preg_replace('/\s+unsigned$/', '', $type), self::MYSQL_EXACT, true),
            DriverName::Postgres => self::postgres(ltrim($type, '_')),
            DriverName::Sqlite => ! preg_match('/real|floa|doub/', $type),
        };
    }

    private static function postgres(string $type): bool
    {
        return ! preg_match(self::FLOAT, $type) && ! in_array($type, self::PG_NO_EQUALITY, true);
    }
}
