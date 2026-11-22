<?php

namespace App\Transfers\Native;

use App\Enums\DriverName;
use App\Enums\TransferDirection;

final class Compatibility
{
    public static function check(DriverName $driver, string $serverVersion, TransferDirection $dir, ?string $lamanRoot = null): ToolCheck
    {
        $candidates = self::candidates($driver, $dir);

        if ($candidates === []) {
            return ToolCheck::unusable('SQLite always uses the built-in method');
        }

        $best = null;
        $bestRank = -1;
        foreach ($candidates as $tool) {
            $paths = ToolLocator::candidates($tool, $lamanRoot);
            $checks = $paths === []
                ? [self::evaluate($driver, $serverVersion, $dir, $tool, null, null)]
                : array_map(fn (string $path): ToolCheck => self::evaluate($driver, $serverVersion, $dir, $tool, $path, ToolLocator::versionOutput($path)), $paths);

            foreach ($checks as $check) {
                if ($check->usable) {
                    return $check;
                }
                $rank = self::rank($check);
                if ($rank > $bestRank) {
                    $best = $check;
                    $bestRank = $rank;
                }
            }
        }

        return $best;
    }

    /** Found-but-incompatible beats no version beats not found. */
    private static function rank(ToolCheck $check): int
    {
        if ($check->path === null) {
            return 0;
        }

        return str_contains($check->reason, 'did not report a version') ? 1 : 2;
    }

    public static function evaluate(DriverName $driver, string $serverVersion, TransferDirection $dir, string $tool, ?string $path, ?string $versionOutput): ToolCheck
    {
        if ($driver === DriverName::Sqlite) {
            return ToolCheck::unusable('SQLite always uses the built-in method');
        }

        if ($path === null) {
            return ToolCheck::unusable("{$tool} not found — using built-in", $tool);
        }

        $toolVersion = self::toolVersion($versionOutput ?? '');
        if ($toolVersion === null) {
            return ToolCheck::unusable("{$tool} found but did not report a version — using built-in", $tool, $path);
        }

        $serverParsed = self::serverVersion($serverVersion);
        if ($serverParsed === null) {
            return ToolCheck::unusable("Couldn't read the server version — using built-in", $tool, $path);
        }
        $toolMajor = (int) explode('.', $toolVersion)[0];
        $serverMajor = (int) explode('.', $serverParsed)[0];
        $isMaria = stripos((string) $versionOutput, 'MariaDB') !== false;

        $reason = null;
        if ($driver === DriverName::Postgres) {
            if ($toolMajor < $serverMajor) {
                $reason = "{$tool} {$toolMajor} found, server is {$serverMajor} — using built-in";
            }
        } elseif ($driver === DriverName::MariaDb) {
            if (! $isMaria) {
                $reason = "{$tool} from MySQL can't dump MariaDB reliably — using built-in";
            } elseif ($toolMajor < 10) {
                $reason = "{$tool} {$toolMajor} found, server is {$serverMajor} — using built-in";
            }
        } else {
            if ($isMaria) {
                $reason = "{$tool} from MariaDB can't dump MySQL 8+ reliably — using built-in";
            } elseif ($toolMajor < $serverMajor) {
                $reason = "{$tool} {$toolMajor} found, server is {$serverMajor} — using built-in";
            }
        }

        if ($reason !== null) {
            return ToolCheck::unusable($reason, $tool, $path);
        }

        return new ToolCheck(true, $tool, $path, $toolVersion, "{$tool} {$toolVersion}");
    }

    /** @return list<string> */
    private static function candidates(DriverName $driver, TransferDirection $dir): array
    {
        $export = $dir === TransferDirection::Export;

        return match ($driver) {
            DriverName::MySql => [$export ? 'mysqldump' : 'mysql'],
            DriverName::MariaDb => $export ? ['mariadb-dump', 'mysqldump'] : ['mariadb', 'mysql'],
            DriverName::Postgres => [$export ? 'pg_dump' : 'psql'],
            DriverName::Sqlite => [],
        };
    }

    private static function toolVersion(string $output): ?string
    {
        if (stripos($output, 'MariaDB') !== false && preg_match('/(\d+\.\d+(?:\.\d+)?)-MariaDB/i', $output, $m)) {
            return $m[1];
        }
        if (preg_match('/\bVer\s+(?:[\d.]+\s+Distrib\s+)?(\d+\.\d+(?:\.\d+)?)/', $output, $m)) {
            return $m[1];
        }

        return preg_match('/(\d+\.\d+(?:\.\d+)?)/', $output, $m) ? $m[1] : null;
    }

    private static function serverVersion(string $version): ?string
    {
        return preg_match('/(\d+)(?:\.(\d+))?/', $version, $m) ? $m[1].'.'.($m[2] ?? '0') : null;
    }
}
