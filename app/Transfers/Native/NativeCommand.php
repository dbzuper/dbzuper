<?php

namespace App\Transfers\Native;

final class NativeCommand
{
    /**
     * @param  list<string>  $argv  argv[0] is the tool path; never contains the password
     * @param  array<string, string>  $env  extra environment for the process
     * @param  list<string>  $tempFiles  files, then directories, to delete in order
     */
    public function __construct(
        public readonly array $argv,
        public readonly array $env = [],
        public readonly array $tempFiles = [],
    ) {}

    public function cleanup(): void
    {
        foreach ($this->tempFiles as $path) {
            if (is_dir($path)) {
                @rmdir($path);
            } elseif (is_file($path)) {
                @unlink($path);
            }
        }
    }
}
