<?php

namespace App\Support\Demo;

use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use LogicException;

/** Fills an empty SQLite file with the commerce demo schema and data, plus optional synthetic tables. */
final class DemoDatabase
{
    public static function build(string $path, int $extraTables = 0): void
    {
        $db = DB::connectUsing('dbzuper_demo', ['driver' => 'sqlite', 'database' => $path, 'prefix' => '', 'foreign_key_constraints' => true], force: true);
        if (! $db instanceof Connection) {
            throw new LogicException('The SQLite driver is expected to build an '.Connection::class.'.');
        }
        try {
            CommerceSchema::create($db);
            if ($extraTables > 0) {
                SyntheticSchema::create($db, $extraTables);
            }
        } finally {
            DB::purge('dbzuper_demo');
        }
    }
}
