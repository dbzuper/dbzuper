<?php

namespace App\Transfers\Native;

use Illuminate\Support\Facades\Cache;
use Symfony\Component\Process\ExecutableFinder;
use Symfony\Component\Process\Process;

final class ToolLocator
{
    public static function find(string $tool, ?string $lamanRoot = null): ?string
    {
        $override = config('dbzuper.transfer_tools.'.$tool);

        if (is_string($override) && $override !== '') {
            return is_file($override) ? $override : null;
        }

        return (new ExecutableFinder)->find($tool) ?? self::findInLaman($tool, $lamanRoot);
    }

    /** Newest version directory under `<root>/bin/<service>/<version>/bin` that holds the tool. */
    private static function findInLaman(string $tool, ?string $root): ?string
    {
        $service = match ($tool) {
            'mariadb', 'mariadb-dump' => 'mariadb',
            'pg_dump', 'psql' => 'postgres',
            'mysql', 'mysqldump' => 'mysql',
            default => null,
        };
        if ($service === null) {
            return null;
        }

        if ($root === null) {
            $home = getenv('HOME') ?: getenv('USERPROFILE');
            if (! is_string($home) || $home === '') {
                return null;
            }
            $root = $home.'/.laman';
        }

        $versions = [];
        foreach (glob($root.'/bin/'.$service.'/*', GLOB_ONLYDIR) ?: [] as $dir) {
            $versions[basename($dir)] = $dir;
        }
        uksort($versions, fn (string $a, string $b): int => version_compare($b, $a));

        foreach ($versions as $dir) {
            foreach ([$tool, $tool.'.exe'] as $name) {
                $candidate = $dir.'/bin/'.$name;
                if (is_file($candidate)) {
                    return $candidate;
                }
            }
        }

        return null;
    }

    public static function versionOutput(string $path): ?string
    {
        $mtime = @filemtime($path) ?: 0;
        $key = 'dbzuper.tool-version.'.sha1($path.'|'.$mtime);

        $cached = Cache::get($key);
        if (is_string($cached)) {
            return $cached;
        }

        try {
            $process = new Process([$path, '--version']);
            $process->setTimeout(5);
            $process->run();
        } catch (\Throwable) {
            return null;
        }

        $output = trim($process->getOutput());
        if (! $process->isSuccessful() || $output === '') {
            return null;
        }

        Cache::put($key, $output, now()->addMinutes(10));

        return $output;
    }
}
