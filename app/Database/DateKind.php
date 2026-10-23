<?php

namespace App\Database;

/** Which date operators a column takes: a calendar date, or a date with a time of day. Anything else is not a date column. */
enum DateKind
{
    case Date;
    case DateTime;

    public static function classify(string $typeName): ?self
    {
        $t = strtolower(trim($typeName));

        // PostgreSQL reports array columns as `_timestamp`, `_date`, … (or `timestamp[]`): not a single date.
        if (str_starts_with($t, '_') || str_contains($t, '[]')) {
            return null;
        }

        return match (true) {
            $t === 'date' => self::Date,
            str_contains($t, 'datetime'), str_contains($t, 'timestamp') => self::DateTime,
            default => null,
        };
    }
}
