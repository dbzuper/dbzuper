<?php

namespace App\Database;

use App\Database\Exceptions\SqlitePathNotAllowed;

final class SqlitePathPolicy
{
    /** @param list<string> $allowedDirectories */
    public function __construct(private readonly array $allowedDirectories) {}

    public function resolve(string $path): string
    {
        $real = realpath($path);
        if ($real === false || ! is_file($real)) {
            throw new SqlitePathNotAllowed('missing', 'The SQLite file does not exist.');
        }

        foreach ($this->allowedDirectories as $directory) {
            $realDirectory = realpath($directory);
            if ($realDirectory === false || ! is_dir($realDirectory)) {
                continue;
            }

            $prefix = rtrim($realDirectory, '\/').DIRECTORY_SEPARATOR;
            if (str_starts_with($this->normalize($real), $this->normalize($prefix))) {
                return $real;
            }
        }

        throw new SqlitePathNotAllowed('outside', 'The SQLite file is outside the directories allowed by DBSUPERB_SQLITE_PATHS.');
    }

    private function normalize(string $path): string
    {
        return PHP_OS_FAMILY === 'Windows' ? strtolower(str_replace('/', '\\', $path)) : $path;
    }
}
