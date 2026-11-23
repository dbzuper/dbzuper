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
            if (! is_finite($v)) {
                throw new \InvalidArgumentException('MySQL cannot store NaN or Infinity');
            }

            return self::float($v);
        }
        $v = self::string($v);
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
        $v = self::string($v);
        if ($bytea) {
            return "'\\x".bin2hex($v)."'::bytea";
        }
        if (str_contains($v, "\r")) {
            // A raw CR doesn't survive psql on Windows (stdin in text mode turns CRLF into LF) or editors that
            // normalise line endings; an escape string keeps it. Quotes are still doubled, never backslashed.
            return "E'".strtr($v, ['\\' => '\\\\', "'" => "''", "\r" => '\\r'])."'";
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
                is_nan($v) => 'NULL', // SQLite stores NaN as NULL itself; Inf has no literal, 9e999 overflows to it
                is_infinite($v) => $v > 0 ? '9e999' : '-9e999',
                default => self::float($v),
            };
        }
        $v = self::string($v);
        if ($blob) {
            return "X'".bin2hex($v)."'";
        }
        if (str_contains($v, "\0")) {
            // A raw NUL truncates the statement on restore; build the text from hex instead.
            return "CAST(X'".bin2hex($v)."' AS TEXT)";
        }
        if (str_contains($v, "\r")) {
            // The sqlite3 CLI reads its input line by line and drops the CR of every CRLF, inside a string literal
            // too. As sqlite3 .dump does, each CR is written as a marker the text doesn't contain, which replace()
            // turns back into char(13). The marker is a backslash, an r and maybe digits: no match can straddle it.
            $marker = '\\r';
            for ($i = 0; str_contains($v, $marker); $i++) {
                $marker = '\\r'.$i;
            }

            return "replace('".str_replace(["'", "\r"], ["''", $marker], $v)."','{$marker}',char(13))";
        }

        return "'".str_replace("'", "''", $v)."'";
    }

    /** PDO pgsql returns bytea as a stream resource. */
    private static function string(mixed $v): string
    {
        if (is_resource($v)) {
            return (string) stream_get_contents($v);
        }
        if (! is_scalar($v) && ! $v instanceof \Stringable) {
            throw new \InvalidArgumentException('Cannot write a '.get_debug_type($v).' as a SQL literal');
        }

        return (string) $v;
    }

    /** Round-trippable and locale independent (var_export uses serialize_precision -1). */
    private static function float(float $v): string
    {
        return var_export($v, true);
    }
}
