<?php

namespace App\Database\Drivers;

use App\Database\Exceptions\InvalidConnectionOption;

/** Rejects values that could inject extra parameters into a PDO DSN. */
final class DsnValue
{
    /** Characters that end a PDO DSN key=value pair (all drivers). */
    public const PDO_UNSAFE = '/[;\0\r\n]/';

    /**
     * Characters that are also unsafe in a libpq conninfo string (pdo_pgsql): whitespace separates
     * keywords, quotes and backslashes delimit or escape values, so any of them can smuggle in
     * extra keywords such as hostaddr= and send the stored password elsewhere.
     */
    public const LIBPQ_UNSAFE = '/[;\0\r\n\s\'\\\\]/';

    /** @param  array<string, mixed>  $values */
    public static function assertSafe(array $values, string $pattern = self::PDO_UNSAFE): void
    {
        foreach ($values as $key => $value) {
            if ($value !== null && (! is_scalar($value) || preg_match($pattern, (string) $value))) {
                throw new InvalidConnectionOption("Invalid characters in {$key}.");
            }
        }
    }

    /** @param  array<string, mixed>  $values */
    public static function assertSafeForLibpq(array $values): void
    {
        self::assertSafe($values, self::LIBPQ_UNSAFE);
    }
}
