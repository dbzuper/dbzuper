<?php

namespace App\Transfers\Native;

use App\Enums\DriverName;
use App\Enums\TransferDirection;

final class Compatibility
{
    public static function check(DriverName $driver, string $serverVersion, TransferDirection $dir): ToolCheck
    {
        $candidates = self::candidates($driver, $dir);

        if ($candidates === []) {
            return ToolCheck::unusable('SQLite always uses the built-in method');
        }

        $first = null;
        foreach ($candidates as $tool) {
            $path = ToolLocator::find($tool);
            $output = $path === null ? null : ToolLocator::versionOutput($path);
            $check = self::evaluate($driver, $serverVersion, $dir, $tool, $path, $output);

            if ($check->usable) {
                return $check;
            }
            $first ??= $check;
        }

        return $first;
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
        $toolMajor = (int) explode('.', $toolVersion)[0];
        $serverMajor = $serverParsed === null ? 0 : (int) explode('.', $serverParsed)[0];
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
