<?php

namespace App\Transfers\Export;

/** Renders PHP values as SQL literals per engine. Only real PHP int/float/bool are bare; strings are always quoted. */
final class Literals
{
    public static function mysql(mixed $v, bool $binary): string
    {
        if ($v === null) {
            return 'NULL';
        }
        if (is_bool($v)) {
            return $v ? '1' : '0';
        }
        if (is_int($v)) {
            return (string) $v;
        }
        if (is_float($v)) {
            return is_finite($v) ? self::float($v) : 'NULL';
        }
        $v = (string) $v;
        if ($binary) {
            return $v === '' ? "''" : '0x'.bin2hex($v);
        }

        return "'".strtr($v, [
            "\0" => '\\0', "\n" => '\\n', "\r" => '\\r', '\\' => '\\\\',
            "'" => "\\'", '"' => '\\"', "\x1a" => '\\Z',
        ])."'";
    }

    public static function postgres(mixed $v, bool $bytea): string
    {
        if ($v === null) {
            return 'NULL';
        }
        if (is_bool($v)) {
            return $v ? 'true' : 'false';
        }
        if (is_int($v)) {
            return (string) $v;
        }
        if (is_float($v)) {
            return match (true) {
                is_nan($v) => "'NaN'",
                is_infinite($v) => $v > 0 ? "'Infinity'" : "'-Infinity'",
                default => self::float($v),
            };
        }
        $v = (string) $v;
        if ($bytea) {
            return "'\\x".bin2hex($v)."'::bytea";
        }

        return "'".str_replace("'", "''", $v)."'";
    }

    public static function sqlite(mixed $v, bool $blob): string
    {
        if ($v === null) {
            return 'NULL';
        }
        if (is_bool($v)) {
            return $v ? '1' : '0';
        }
        if (is_int($v)) {
            return (string) $v;
        }
        if (is_float($v)) {
            return match (true) {
                is_nan($v) => 'NULL',
                is_infinite($v) => $v > 0 ? '9e999' : '-9e999',
                default => self::float($v),
            };
        }
        $v = (string) $v;
        if ($blob) {
            return "X'".bin2hex($v)."'";
        }

        return "'".str_replace("'", "''", $v)."'";
    }

    /** Round-trippable and locale independent (var_export uses serialize_precision -1). */
    private static function float(float $v): string
    {
        return var_export($v, true);
    }
}
