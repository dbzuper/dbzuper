<?php

namespace App\Transfers\Native;

use Illuminate\Support\Facades\Cache;
use Symfony\Component\Process\ExecutableFinder;
use Symfony\Component\Process\Process;

final class ToolLocator
{
    public static function find(string $tool, ?string $lamanRoot = null): ?string
    {
        return self::candidates($tool, $lamanRoot)[0] ?? null;
    }

    /**
     * Every path worth trying for a tool: the configured override alone when set,
     * else the PATH hit followed by laman version directories, newest first.
     *
     * @return list<string>
     */
    public static function candidates(string $tool, ?string $lamanRoot = null): array
    {
        $override = config('dbzuper.transfer_tools.'.$tool);

        if (is_string($override) && $override !== '') {
            return is_file($override) ? [$override] : [];
        }

        $paths = [];
        $onPath = (new ExecutableFinder)->find($tool);
        if ($onPath !== null) {
            $paths[] = $onPath;
        }

        return array_values(array_unique([...$paths, ...self::lamanPaths($tool, $lamanRoot)]));
    }

    /** @return list<string> */
    private static function lamanPaths(string $tool, ?string $root): array
    {
        $service = match ($tool) {
            'mariadb', 'mariadb-dump' => 'mariadb',
            'pg_dump', 'psql' => 'postgres',
            'mysql', 'mysqldump' => 'mysql',
            default => null,
        };
        if ($service === null) {
            return [];
        }

        if ($root === null) {
            $home = getenv('HOME') ?: getenv('USERPROFILE');
            if (! is_string($home) || $home === '') {
                return [];
            }
            $root = $home.'/.laman';
        }

        $versions = [];
        foreach (glob($root.'/bin/'.$service.'/*', GLOB_ONLYDIR) ?: [] as $dir) {
            $versions[basename($dir)] = $dir;
        }
        uksort($versions, fn (string $a, string $b): int => version_compare($b, $a));

        $found = [];
        foreach ($versions as $dir) {
            foreach ([$tool, $tool.'.exe', $tool.'.bat', $tool.'.cmd'] as $name) {
                $candidate = $dir.'/bin/'.$name;
                if (is_file($candidate)) {
                    $found[] = $candidate;
                    break;
                }
            }
        }

        return $found;
    }

    public static function versionOutput(string $path): ?string
    {
        $mtime = @filemtime($path) ?: 0;
        $key = 'dbzuper.tool-version.'.sha1($path.'|'.$mtime);

        $cached = Cache::get($key);
        if (is_string($cached)) {
            return $cached === '' ? null : $cached;
        }

        try {
            $process = new Process([$path, '--version']);
            $process->setTimeout(5);
            $process->run();
            $output = trim($process->getOutput());
            $ok = $process->isSuccessful() && $output !== '';
        } catch (\Throwable) {
            $ok = false;
            $output = '';
        }

        if (! $ok) {
            Cache::put($key, '', now()->addSeconds(60));

            return null;
        }

        Cache::put($key, $output, now()->addMinutes(10));

        return $output;
    }
}
