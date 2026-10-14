<?php

namespace Tests\Support;

use PDO;
use Throwable;

final class Engines
{
    public const ENGINES = ['sqlite', 'mysql', 'mariadb', 'pgsql'];

    public const DATABASE = 'dbsuperb_test';

    private static ?string $sqlitePath = null;

    /** @return array{host: ?string, port: ?int, database: string, username: ?string, password: ?string} */
    public static function params(string $engine): array
    {
        if ($engine === 'sqlite') {
            return ['host' => null, 'port' => null, 'database' => self::sqlitePath(), 'username' => null, 'password' => null];
        }

        $prefix = 'TEST_'.strtoupper($engine).'_';

        return [
            'host' => (string) env($prefix.'HOST', '127.0.0.1'),
            'port' => (int) env($prefix.'PORT', ['mysql' => 3307, 'mariadb' => 3308, 'pgsql' => 5432][$engine]),
            'database' => self::DATABASE,
            'username' => (string) env($prefix.'USERNAME', $engine === 'pgsql' ? 'postgres' : 'root'),
            'password' => (string) env($prefix.'PASSWORD', ''),
        ];
    }

    /** Fresh SQLite file per test run, inside storage/framework/testing/sqlite (an allowed SQLite dir in tests). */
    public static function sqlitePath(): string
    {
        if (self::$sqlitePath === null || ! is_file(self::$sqlitePath)) {
            $dir = self::sqliteDirectory();
            @mkdir($dir, 0777, true);
            self::$sqlitePath = $dir.DIRECTORY_SEPARATOR.'engine-'.bin2hex(random_bytes(4)).'.sqlite';
            touch(self::$sqlitePath);
        }

        return self::$sqlitePath;
    }

    public static function sqliteDirectory(): string
    {
        return storage_path('framework'.DIRECTORY_SEPARATOR.'testing'.DIRECTORY_SEPARATOR.'sqlite');
    }

    public static function resetSqlite(): void
    {
        self::$sqlitePath = null;
    }

    public static function skipUnlessAvailable(string $engine): void
    {
        if ($engine === 'sqlite') {
            return;
        }

        $p = self::params($engine);
        $socket = @fsockopen($p['host'], $p['port'], $errno, $errstr, 1);
        if ($socket === false) {
            test()->markTestSkipped("{$engine} test server not reachable on {$p['host']}:{$p['port']}");
        }
        fclose($socket);

        try {
            self::prepare($engine);
        } catch (Throwable $e) {
            test()->markTestSkipped("{$engine} test server unusable: ".$e->getMessage());
        }
    }

    public static function prepare(string $engine): void
    {
        if ($engine !== 'pgsql') {
            return; // MySQL/MariaDB containers create dbsuperb_test themselves.
        }

        $pdo = self::rawPdo($engine, 'postgres');
        $exists = $pdo->query("select 1 from pg_database where datname = '".self::DATABASE."'")->fetchColumn();
        if (! $exists) {
            $pdo->exec('create database '.self::DATABASE);
        }
    }

    public static function pdo(string $engine): PDO
    {
        return self::rawPdo($engine, self::params($engine)['database']);
    }

    private static function rawPdo(string $engine, string $database): PDO
    {
        $p = self::params($engine);
        $dsn = match ($engine) {
            'sqlite' => 'sqlite:'.$database,
            'pgsql' => "pgsql:host={$p['host']};port={$p['port']};dbname={$database}",
            default => "mysql:host={$p['host']};port={$p['port']};dbname={$database};charset=utf8mb4",
        };

        return new PDO($dsn, $p['username'], $p['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 3]);
    }
}
