<?php

namespace App\Database;

final class CellValue
{
    public const MAX_CHARS = 200;

    /** A JSON-safe, size-bounded presentation of one database value. */
    public static function present(mixed $value): string|int|float|bool|null
    {
        if (is_resource($value)) {
            $value = stream_get_contents($value);
        }
        if ($value === null || is_bool($value) || is_int($value) || is_float($value)) {
            return $value;
        }

        $value = (string) $value;
        if (! mb_check_encoding($value, 'UTF-8')) {
            return '[binary '.strlen($value).' bytes]';
        }

        return mb_strlen($value) > self::MAX_CHARS ? mb_substr($value, 0, self::MAX_CHARS).'…' : $value;
    }
}
