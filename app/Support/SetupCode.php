<?php

namespace App\Support;

use RuntimeException;

/**
 * The one-time code the setup screen asks for while no administrator exists, so a fresh install reachable
 * on a network can't be claimed by whoever opens it first. The code is shown in the server log on start and
 * by `php artisan dbzuper:setup-code`, and retired once the administrator is created.
 */
final class SetupCode
{
    /** No 0/O or 1/I, which are easy to misread in a log. */
    private const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

    private const LENGTH = 12;

    /** The current code, issuing one if there is none yet. */
    public function current(): string
    {
        $path = $this->path();
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0700, true);
        }

        // Exclusive create: of two requests issuing a code at once, one writes it and the other reads it.
        $previous = umask(0077);
        $handle = @fopen($path, 'x');
        umask($previous);
        if ($handle === false) {
            return $this->stored($path);
        }
        $code = implode('-', str_split($this->generate(), 4));
        fwrite($handle, $code);
        fclose($handle);

        return $code;
    }

    /** The code in an existing file, waiting briefly while the process that created it is still writing it. */
    private function stored(string $path): string
    {
        for ($attempt = 0; $attempt < 50; $attempt++) {
            $code = is_file($path) ? trim((string) file_get_contents($path)) : '';
            if ($code !== '') {
                return $code;
            }
            usleep(10_000);
        }

        throw new RuntimeException("The setup code file {$path} is empty.");
    }

    /** Whether $input is the current code, ignoring case, spaces and dashes. */
    public function matches(string $input): bool
    {
        $path = $this->path();
        if (! is_file($path)) {
            return false;
        }
        $expected = self::normalize((string) file_get_contents($path));

        return $expected !== '' && hash_equals($expected, self::normalize($input));
    }

    public function forget(): void
    {
        if (is_file($this->path())) {
            unlink($this->path());
        }
    }

    private function generate(): string
    {
        $code = '';
        for ($i = 0; $i < self::LENGTH; $i++) {
            $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
        }

        return $code;
    }

    private static function normalize(string $code): string
    {
        return strtoupper((string) preg_replace('/[\s-]+/', '', $code));
    }

    private function path(): string
    {
        return (string) config('dbzuper.setup_code_path');
    }
}
