<?php

namespace Tests\Support;

use App\Enums\DriverName;
use App\Enums\TransferDirection;
use App\Models\SavedConnection;
use App\Transfers\Native\Compatibility;
use App\Transfers\Native\ToolCheck;
use App\Transfers\Native\ToolLocator;
use PDO;
use Throwable;

final class Engines
{
    public const ENGINES = ['sqlite', 'mysql', 'mariadb', 'pgsql'];

    public const DATABASE = 'dbzuper_test';

    public const RESTORE_DATABASE = 'dbzuper_test_restore';

    private static ?string $sqlitePath = null;

    private static ?string $restoreSqlitePath = null;

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
            self::unavailable("{$engine} test server not reachable on {$p['host']}:{$p['port']}");
        }
        fclose($socket);

        try {
            self::prepare($engine);
        } catch (Throwable $e) {
            self::unavailable("{$engine} test server unusable: ".$e->getMessage());
        }
    }

    /** Skips when the native tool isn't installed (DBZUPER_*_PATH, PATH or laman); fails when DBZUPER_REQUIRE_NATIVE_TOOLS=1. */
    public static function skipUnlessTool(string $tool): void
    {
        if (ToolLocator::find($tool) === null) {
            self::unavailable("{$tool} not found", 'DBZUPER_REQUIRE_NATIVE_TOOLS');
        }
    }

    /**
     * The compatible native tool for an engine and direction (the one the app would pick). Skips, or fails when
     * DBZUPER_REQUIRE_NATIVE_TOOLS=1, when it is missing or doesn't suit the test server. Call skipUnlessAvailable()
     * first.
     */
    public static function nativeTool(string $engine, TransferDirection $direction): ToolCheck
    {
        $export = $direction === TransferDirection::Export;
        self::skipUnlessTool(match ($engine) {
            'pgsql' => $export ? 'pg_dump' : 'psql',
            'mariadb' => $export ? 'mariadb-dump' : 'mariadb',
            default => $export ? 'mysqldump' : 'mysql',
        });

        $version = (string) self::pdo($engine)->getAttribute(PDO::ATTR_SERVER_VERSION);
        $check = Compatibility::check(DriverName::from($engine), $version, $direction);
        if (! $check->usable) {
            self::unavailable($check->reason, 'DBZUPER_REQUIRE_NATIVE_TOOLS');
        }

        return $check;
    }

    /** Skips locally; fails when the requirement variable is 1 (CI) so a missing engine or tool cannot pass silently. */
    private static function unavailable(string $reason, string $requirement = 'DBZUPER_REQUIRE_ENGINES'): never
    {
        if (filter_var(env($requirement, false), FILTER_VALIDATE_BOOLEAN)) {
            test()->fail("{$reason} ({$requirement}=1)");
        }

        test()->markTestSkipped($reason);
    }

    public static function prepare(string $engine): void
    {
        if ($engine !== 'pgsql') {
            // Fresh containers create dbzuper_test themselves; older ones may predate the name.
            self::serverPdo($engine)->exec('create database if not exists '.self::DATABASE);

            return;
        }

        $pdo = self::rawPdo($engine, 'postgres');
        $exists = $pdo->query("select 1 from pg_database where datname = '".self::DATABASE."'")->fetchColumn();
        if (! $exists) {
            $pdo->exec('create database '.self::DATABASE);
        }
    }

    /**
     * Drops and recreates dbzuper_test_restore (SQLite: a fresh file) and returns a saved connection to it, so a
     * restore never lands in dbzuper_test while that is the export source. Call skipUnlessAvailable() first.
     */
    public static function prepareRestoreTarget(string $engine): SavedConnection
    {
        self::dropRestoreTarget($engine);

        if ($engine === 'sqlite') {
            $dir = self::sqliteDirectory();
            @mkdir($dir, 0777, true);
            self::$restoreSqlitePath = $dir.DIRECTORY_SEPARATOR.'restore-'.bin2hex(random_bytes(4)).'.sqlite';
            touch(self::$restoreSqlitePath);

            return self::savedConnection('sqlite', ['name' => 'sqlite restore target', 'database' => self::$restoreSqlitePath]);
        }

        $server = self::serverPdo($engine);
        if ($engine === 'pgsql') {
            $server->exec('create database '.self::RESTORE_DATABASE);
        } else {
            // Same defaults as the source database, so tables created without an explicit charset match.
            $defaults = $server->query("select default_character_set_name, default_collation_name from information_schema.schemata where schema_name = '".self::DATABASE."'")->fetch(PDO::FETCH_NUM);
            $server->exec('create database '.self::RESTORE_DATABASE.($defaults ? " character set {$defaults[0]} collate {$defaults[1]}" : ''));
        }

        return self::savedConnection($engine, ['name' => "{$engine} restore target", 'database' => self::RESTORE_DATABASE]);
    }

    public static function dropRestoreTarget(string $engine): void
    {
        if ($engine === 'sqlite') {
            // Also files left by earlier runs that died before cleaning up.
            foreach (glob(self::sqliteDirectory().DIRECTORY_SEPARATOR.'restore-*.sqlite') ?: [] as $stale) {
                @unlink($stale);
            }
            self::$restoreSqlitePath = null;

            return;
        }

        // PostgreSQL: WITH (FORCE) ends sessions still open on the database (a connection a failed test left).
        self::serverPdo($engine)->exec('drop database if exists '.self::RESTORE_DATABASE.($engine === 'pgsql' ? ' with (force)' : ''));
    }

    public static function savedConnection(string $engine, array $overrides = []): SavedConnection
    {
        $p = self::params($engine);

        return new SavedConnection(array_merge([
            'name' => "{$engine} test",
            'driver' => DriverName::from($engine),
            'host' => $p['host'],
            'port' => $p['port'],
            'database' => $p['database'],
            'username' => $p['username'],
            'password' => $p['password'],
            'options' => [],
            'read_only' => false,
        ], $overrides));
    }

    public static function pdo(string $engine): PDO
    {
        return self::rawPdo($engine, self::params($engine)['database']);
    }

    /** A connection to the server rather than the test database, for creating test databases and roles. */
    public static function serverPdo(string $engine): PDO
    {
        return self::rawPdo($engine, $engine === 'pgsql' ? 'postgres' : '');
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
