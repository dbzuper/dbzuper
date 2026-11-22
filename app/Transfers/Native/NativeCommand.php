<?php

namespace App\Transfers\Native;

final class NativeCommand
{
    /** @var array<int, list<string>> temp files of commands not cleaned up yet */
    private static array $pending = [];

    private static int $nextKey = 0;

    private readonly int $key;

    private static bool $shutdownRegistered = false;

    /**
     * @param  list<string>  $argv  argv[0] is the tool path; never contains the password
     * @param  array<string, string>  $env  extra environment for the process
     * @param  list<string>  $tempFiles  files, then directories, to delete in order
     */
    public function __construct(
        public readonly array $argv,
        public readonly array $env = [],
        public readonly array $tempFiles = [],
    ) {
        $this->key = ++self::$nextKey;
        if ($tempFiles !== []) {
            // The options file holds the password: if the worker dies fatally before cleanup(), it still goes.
            self::$pending[$this->key] = $tempFiles;
            if (! self::$shutdownRegistered) {
                self::$shutdownRegistered = true;
                register_shutdown_function(static function (): void {
                    foreach (self::$pending as $files) {
                        self::delete($files);
                    }
                    self::$pending = [];
                });
            }
        }
    }

    public function cleanup(): void
    {
        self::delete($this->tempFiles);
        unset(self::$pending[$this->key]);
    }

    /** @return int temp-file sets still waiting for cleanup() (for tests) */
    public static function pendingCount(): int
    {
        return count(self::$pending);
    }

    /** @param list<string> $paths */
    private static function delete(array $paths): void
    {
        foreach ($paths as $path) {
            if (is_dir($path)) {
                @rmdir($path);
            } elseif (is_file($path)) {
                @unlink($path);
            }
        }
    }
}
