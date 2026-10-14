<?php

namespace App\Console\Commands;

use App\Support\Demo\CommerceSchema;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class DemoDatabaseCommand extends Command
{
    protected $signature = 'dbsuperb:demo-database {path? : Target SQLite file (default storage/app/demo/commerce.sqlite)} {--force : Overwrite the target file if it exists}';

    protected $description = 'Create a small commerce SQLite database to explore in DBSuperb';

    public function handle(): int
    {
        $path = $this->argument('path') ?? storage_path('app/demo/commerce.sqlite');

        if (file_exists($path)) {
            if (! $this->option('force')) {
                $this->error("{$path} already exists. Re-run with --force to overwrite it.");

                return self::FAILURE;
            }
            if (! @unlink($path)) {
                $this->error("Could not remove existing file {$path}.");

                return self::FAILURE;
            }
        }

        $dir = dirname($path);
        if (! is_dir($dir) && ! @mkdir($dir, 0777, true) && ! is_dir($dir)) {
            $this->error("Could not create directory {$dir}.");

            return self::FAILURE;
        }
        if (! @touch($path)) {
            $this->error("Could not create file {$path}.");

            return self::FAILURE;
        }

        $db = DB::connectUsing('dbsuperb_demo', ['driver' => 'sqlite', 'database' => $path, 'prefix' => '', 'foreign_key_constraints' => true], force: true);
        try {
            CommerceSchema::create($db);
        } finally {
            DB::purge('dbsuperb_demo');
        }

        $this->info("Demo database written to {$path}");
        $this->line('Add its directory to DBSUPERB_SQLITE_PATHS to connect to it.');

        return self::SUCCESS;
    }
}
