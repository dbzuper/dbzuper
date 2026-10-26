<?php

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\Support\Engines;

/**
 * DBZuper's own database may be MySQL/MariaDB. Database names there are case- and accent-sensitive on Linux, so the
 * per-database columns must compare exactly, or rows of `Shop` and `shop` would mix.
 */
it('keeps per-database rows of names differing only in case or accents apart', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $server = Engines::serverPdo($engine);
    $server->exec('DROP DATABASE IF EXISTS dbsuperb_test_appdb');
    $server->exec('CREATE DATABASE dbsuperb_test_appdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    $p = Engines::params($engine);
    config(['database.connections.appdb' => array_merge(config('database.connections.mysql'), [
        'driver' => $engine, 'host' => $p['host'], 'port' => $p['port'], 'database' => 'dbsuperb_test_appdb',
        'username' => $p['username'], 'password' => $p['password'], 'collation' => 'utf8mb4_unicode_ci',
    ])]);

    try {
        Artisan::call('migrate', ['--database' => 'appdb', '--force' => true]);
        $db = DB::connection('appdb');
        $user = $db->table('users')->insertGetId(['name' => 'a', 'email' => 'a@example.test', 'password' => 'x']);
        $connection = $db->table('connections')->insertGetId(['user_id' => $user, 'name' => 'c', 'driver' => 'mysql', 'read_only' => 0, 'store_history' => 1]);
        foreach (['Shop', 'shop', 'café', 'cafe'] as $name) {
            $db->table('layout_positions')->insert(['connection_id' => $connection, 'database' => $name, 'payload' => '[]']);
            $db->table('pinned_tables')->insert(['user_id' => $user, 'connection_id' => $connection, 'database' => $name, 'table_name' => 'orders', 'position' => 1]);
        }

        expect($db->table('layout_positions')->where('database', 'Shop')->count())->toBe(1)
            ->and($db->table('pinned_tables')->where('database', 'cafe')->count())->toBe(1);
    } finally {
        DB::purge('appdb');
        $server->exec('DROP DATABASE IF EXISTS dbsuperb_test_appdb');
    }
})->with(['mysql', 'mariadb']);
