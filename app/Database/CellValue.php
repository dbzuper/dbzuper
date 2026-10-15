<?php

namespace App\Database;

final class CellValue
{
    public const MAX_CHARS = 200;

    /** Cell cap for SQL workspace results, where the user asked for the data. */
    public const RESULT_CHARS = 4000;

    /** Largest integer a JavaScript number holds exactly (2^53 - 1). */
    public const MAX_SAFE_INTEGER = 9007199254740991;

    /** A JSON-safe, size-bounded presentation of one database value. */
    public static function present(mixed $value, int $maxChars = self::MAX_CHARS): string|int|float|bool|null
    {
        if (is_resource($value)) {
            $value = stream_get_contents($value);
        }
        if (is_float($value) && ! is_finite($value)) {
            return is_nan($value) ? 'NaN' : ($value > 0 ? 'Infinity' : '-Infinity');
        }
        if (is_int($value) && ($value > self::MAX_SAFE_INTEGER || $value < -self::MAX_SAFE_INTEGER)) {
            return (string) $value;
        }
        if ($value === null || is_bool($value) || is_int($value) || is_float($value)) {
            return $value;
        }

        $value = (string) $value;
        if (! mb_check_encoding($value, 'UTF-8')) {
            return '[binary '.strlen($value).' bytes]';
        }

        return mb_strlen($value) > $maxChars ? mb_substr($value, 0, $maxChars).'…' : $value;
    }
}
