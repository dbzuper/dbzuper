<?php

namespace App\Database\Drivers;

use App\Database\Exceptions\InvalidConnectionOption;

/** Rejects values that could inject extra parameters into a PDO DSN. */
final class DsnValue
{
    /** @param  array<string, mixed>  $values */
    public static function assertSafe(array $values): void
    {
        foreach ($values as $key => $value) {
            if ($value !== null && (! is_scalar($value) || preg_match('/[;\0\r\n]/', (string) $value))) {
                throw new InvalidConnectionOption("Invalid characters in {$key}.");
            }
        }
    }
}
