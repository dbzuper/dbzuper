<?php

namespace App\Console\Commands;

use App\Support\Demo\CommerceSchema;
use App\Support\Demo\SyntheticSchema;
use Illuminate\Console\Command;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use LogicException;

class DemoDatabaseCommand extends Command
{
    protected $signature = 'dbzuper:demo-database {path? : Target SQLite file (default storage/app/demo/commerce.sqlite)} {--force : Overwrite the target file if it exists} {--tables=0 : Also create N synthetic tables (0-20000) for large-schema testing}';

    protected $description = 'Create a small commerce SQLite database to explore in DBZuper';

    public function handle(): int
    {
        $raw = $this->option('tables');
        $extra = (int) $raw;
        if (($raw !== null && ! ctype_digit((string) $raw)) || $extra < 0 || $extra > 20000) {
            $this->error('--tables must be between 0 and 20000.');

            return self::FAILURE;
        }

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

        $db = DB::connectUsing('dbzuper_demo', ['driver' => 'sqlite', 'database' => $path, 'prefix' => '', 'foreign_key_constraints' => true], force: true);
        if (! $db instanceof Connection) {
            throw new LogicException('The SQLite driver is expected to build an '.Connection::class.'.');
        }
        try {
            CommerceSchema::create($db);
            if ($extra > 0) {
                SyntheticSchema::create($db, $extra);
            }
        } finally {
            DB::purge('dbzuper_demo');
        }

        $this->info("Demo database written to {$path}");
        $this->line('Add its directory to DBZUPER_SQLITE_PATHS to connect to it.');

        return self::SUCCESS;
    }
}
