<?php

namespace App\Support;

/** The DBZuper version, for dump headers: composer.json "version" if set, else the newest CHANGELOG.md heading. */
final class AppVersion
{
    public static function detect(string $basePath): string
    {
        $composer = self::read($basePath.'/composer.json');
        if ($composer !== false) {
            $version = json_decode($composer, true)['version'] ?? null;
            if (is_string($version) && $version !== '') {
                return $version;
            }
        }

        $changelog = self::read($basePath.'/CHANGELOG.md');
        // "## 0.3.0 (2026-11-10)", "## [0.3.0] - 2026-11-10" or "## v0.3.0".
        if ($changelog !== false && preg_match('/^##\s+\[?v?(\d+\.\d+\.\d+[\w.+-]*)\]?/m', $changelog, $m) === 1) {
            return $m[1];
        }

        return 'dev';
    }

    /** A missing file is no error here; checked first, since a warning is reported even when silenced. */
    private static function read(string $path): string|false
    {
        return is_file($path) ? @file_get_contents($path) : false;
    }
}
