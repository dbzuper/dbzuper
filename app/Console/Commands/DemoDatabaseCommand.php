<?php

namespace App\Console\Commands;

use App\Support\Demo\CommerceSchema;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class DemoDatabaseCommand extends Command
{
    protected $signature = 'dbsuperb:demo-database {path? : Target SQLite file (default storage/app/demo/commerce.sqlite)}';

    protected $description = 'Create a small commerce SQLite database to explore in DBSuperb';

    public function handle(): int
    {
        $path = $this->argument('path') ?? storage_path('app/demo/commerce.sqlite');
        @mkdir(dirname($path), 0777, true);
        @unlink($path);
        touch($path);

        $db = DB::connectUsing('dbsuperb_demo', ['driver' => 'sqlite', 'database' => $path, 'prefix' => '', 'foreign_key_constraints' => true], force: true);
        CommerceSchema::create($db);
        DB::purge('dbsuperb_demo');

        $this->info("Demo database written to {$path}");
        $this->line('Add its directory to DBSUPERB_SQLITE_PATHS to connect to it.');

        return self::SUCCESS;
    }
}
