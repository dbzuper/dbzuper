<?php

use App\Database\ConnectionFactory;
use App\Enums\DriverName;
use App\Models\Transfer;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Export\MySqlBuiltinExporter;
use App\Transfers\Import\BuiltinRestorer;
use App\Transfers\Io\DumpReader;
use App\Transfers\Io\DumpWriter;
use App\Transfers\TransferCancelled;
use App\Transfers\TransferProgress;
use Illuminate\Database\Connection;
use Tests\Support\Engines;
use Tests\Support\Fingerprint;
use Tests\Support\TransferFixture;

/** Progress that remembers what the exporter reported instead of saving a Transfer row. */
function mysqlBuiltinProgress(): TransferProgress
{
    return new class(new Transfer) extends TransferProgress
    {
        public int $rows = 0;

        /** @var array<string, int> */
        public array $tableRows = [];

        public int $cancelChecks = 0;

        public function advance(int $bytes = 0, int $rows = 0, int $statements = 0, ?string $table = null): void
        {
            $this->rows += $rows;
            if ($table !== null) {
                $this->tableRows[$table] = ($this->tableRows[$table] ?? 0) + $rows;
            }
        }

        public function flush(): void {}

        public function checkCancelled(): void
        {
            $this->cancelChecks++;
        }
    };
}

/** @param list<string>|null $tables */
function mysqlBuiltinOptions(?array $tables = null, bool $structure = true, bool $data = true, bool $drop = false): ExportOptions
{
    return new ExportOptions(tables: $tables, structure: $structure, data: $data, dropFirst: $drop, gzip: false);
}

/** Exports through the registry (as the job will) into a temp file and returns its path. */
function mysqlBuiltinExport(Connection $db, string $engine, ExportOptions $o, ?TransferProgress $p = null): string
{
    $path = (string) tempnam(sys_get_temp_dir(), 'dbz-my-');
    $writer = new DumpWriter($path, $o->gzip);
    try {
        app(BuiltinExporters::class)->for(DriverName::from($engine))->export($db, $o, $writer, $p ?? mysqlBuiltinProgress());
    } catch (Throwable $e) {
        $writer->abort();

        throw $e;
    }
    $writer->close();

    return $path;
}

/** Restores the file with BuiltinRestorer into the database $db is open on (on a connection of its own). */
function mysqlBuiltinRestore(Connection $db, string $engine, string $path): void
{
    app(BuiltinRestorer::class)->run(Engines::savedConnection($engine, ['database' => $db->getDatabaseName()]), new DumpReader($path), mysqlBuiltinProgress());
}

/** @return array{tables: list<string>, views: list<string>, triggers: list<string>} */
function mysqlBuiltinObjects(Connection $db): array
{
    $names = fn (string $sql) => array_map(fn ($r) => (string) $r->n, $db->select($sql));

    return [
        'tables' => $names("SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type <> 'VIEW' ORDER BY 1"),
        'views' => $names("SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'VIEW' ORDER BY 1"),
        'triggers' => $names('SELECT trigger_name AS n FROM information_schema.triggers WHERE trigger_schema = DATABASE() ORDER BY 1'),
    ];
}

/**
 * Sets up the fixture in dbzuper_test and an empty dbzuper_test_restore, runs the test, and always cleans both up.
 *
 * @param  Closure(Connection $source, Connection $target): mixed  $test
 */
function mysqlBuiltinRoundTrip(string $engine, Closure $test): void
{
    Engines::skipUnlessAvailable($engine);
    $factory = app(ConnectionFactory::class);
    $sourceConnection = Engines::savedConnection($engine);
    $targetConnection = Engines::prepareRestoreTarget($engine);
    $source = $factory->make($sourceConnection);
    $target = $factory->make($targetConnection);
    try {
        TransferFixture::drop($source, $engine);
        TransferFixture::create($source, $engine);
        $test($source, $target);
    } finally {
        $factory->release($target);
        TransferFixture::drop($source, $engine);
        $factory->release($source);
        Engines::dropRestoreTarget($engine);
    }
}

/** Fingerprint on a fresh connection, so neither side's session settings (time zone, sql_mode) colour it. */
function mysqlBuiltinFingerprint(string $engine, bool $target): array
{
    $saved = $target
        ? Engines::savedConnection($engine, ['database' => Engines::RESTORE_DATABASE])
        : Engines::savedConnection($engine);

    return app(ConnectionFactory::class)->using($saved, fn (Connection $db) => Fingerprint::of($db, $engine));
}

it('registers for mysql and mariadb and lists what it leaves out', function () {
    $registry = app(BuiltinExporters::class);

    expect($registry->for(DriverName::MySql))->toBeInstanceOf(MySqlBuiltinExporter::class)
        ->and($registry->for(DriverName::MariaDb))->toBeInstanceOf(MySqlBuiltinExporter::class)
        ->and((new MySqlBuiltinExporter)->gaps())->toBe([
            'stored procedures and functions',
            'events',
            'sequences (MariaDB)',
            'system-versioned history (MariaDB, current rows only)',
        ]);
});

it('round-trips the fixture through a built-in dump', function (string $engine) {
    mysqlBuiltinRoundTrip($engine, function (Connection $source, Connection $target) use ($engine) {
        $progress = mysqlBuiltinProgress();
        $path = mysqlBuiltinExport($source, $engine, mysqlBuiltinOptions(), $progress);
        try {
            $sql = (string) file_get_contents($path);
            mysqlBuiltinRestore($target, $engine, $path);
        } finally {
            @unlink($path);
        }

        expect(mysqlBuiltinFingerprint($engine, true))->toBe(mysqlBuiltinFingerprint($engine, false));

        // The session header, then the footer that turns the checks back on.
        expect($sql)->toStartWith("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\nSET TIME_ZONE='+00:00';\n")
            ->and($sql)->toEndWith("SET FOREIGN_KEY_CHECKS=1;\nSET UNIQUE_CHECKS=1;\n")
            // Portable: no definer, and nothing names the source database (the fingerprint can't see that).
            ->and($sql)->not->toContain('DEFINER=')
            ->and($sql)->not->toContain('NO_AUTO_CREATE_USER')
            ->and($sql)->not->toContain('`'.Engines::DATABASE.'`')
            // The INSERT trigger is created after the rows it has already run on.
            ->and(preg_match('/CREATE TRIGGER `?rt_insert_log_mark`? /', $sql, $m, PREG_OFFSET_CAPTURE))->toBe(1)
            ->and($m[0][1])->toBeGreaterThan(strrpos($sql, 'INSERT INTO `rt_insert_log`'))
            // Generated columns are left to the server.
            ->and($sql)->toContain('INSERT INTO `rt_order_items` (`order_id`, `line_no`, `qty`, `price`, `note`) VALUES');

        expect(mysqlBuiltinObjects($target))->toBe(mysqlBuiltinObjects($source));
        $fixtureRows = ['rt_types' => 3, 'rt_floats' => 3, 'rt_big' => 2, 'rt_order_items' => 3, 'rt_insert_log' => 2];
        expect(array_intersect_key($progress->tableRows, $fixtureRows))->toEqual($fixtureRows)
            ->and($progress->rows)->toBe(array_sum($progress->tableRows))
            ->and($progress->cancelChecks)->toBeGreaterThan(0);
        if ($engine === 'mariadb') {
            expect($target->selectOne('SELECT v FROM rt_versioned WHERE id = 2')->v)->toBe('changed');
        }
    });
})->with(['mysql', 'mariadb']);

it('does not depend on the time zone or sql_mode of either session', function (string $engine) {
    mysqlBuiltinRoundTrip($engine, function (Connection $source, Connection $target) use ($engine) {
        $expected = $source->selectOne("SELECT CONVERT_TZ(stamp, @@session.time_zone, '+00:00') AS s FROM rt_types WHERE id = 1")->s;

        // A hostile reading session: another zone, double quotes as identifiers, no backslash escapes.
        $source->statement("SET time_zone = '-03:00'");
        $source->statement("SET SESSION sql_mode = 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES'");
        $path = mysqlBuiltinExport($source, $engine, mysqlBuiltinOptions());

        // ... and an equally hostile restoring one.
        $target->statement("SET time_zone = '+05:00'");
        $target->statement("SET SESSION sql_mode = 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES'");
        try {
            mysqlBuiltinRestore($target, $engine, $path);
        } finally {
            @unlink($path);
        }

        expect(mysqlBuiltinFingerprint($engine, true))->toBe(mysqlBuiltinFingerprint($engine, false));
        $target->statement("SET time_zone = '+00:00'");
        expect($target->selectOne('SELECT stamp AS s FROM rt_types WHERE id = 1')->s)->toBe($expected);
    });
})->with(['mysql', 'mariadb']);

it('exports only chosen tables', function (string $engine) {
    mysqlBuiltinRoundTrip($engine, function (Connection $source, Connection $target) use ($engine) {
        $path = mysqlBuiltinExport($source, $engine, mysqlBuiltinOptions(['order', 'rt_order_items', 'rt_order_totals']));
        try {
            $sql = (string) file_get_contents($path);
            mysqlBuiltinRestore($target, $engine, $path);
        } finally {
            @unlink($path);
        }

        expect($sql)->not->toContain('rt_types')
            ->and($sql)->not->toContain('rt_insert_log')
            ->and(mysqlBuiltinObjects($target))->toBe([
                'tables' => ['order', 'rt_order_items'],
                'views' => ['rt_order_totals'],
                'triggers' => ['rt_order_items_note'],
            ])
            ->and($target->select('SELECT * FROM `order` ORDER BY id'))->toEqual($source->select('SELECT * FROM `order` ORDER BY id'));
    });
})->with(['mysql', 'mariadb']);

it('exports structure only', function (string $engine) {
    mysqlBuiltinRoundTrip($engine, function (Connection $source, Connection $target) use ($engine) {
        $path = mysqlBuiltinExport($source, $engine, mysqlBuiltinOptions(data: false));
        try {
            $sql = (string) file_get_contents($path);
            mysqlBuiltinRestore($target, $engine, $path);
        } finally {
            @unlink($path);
        }

        expect($sql)->not->toContain('INSERT INTO')
            ->and($sql)->toContain('CREATE TABLE `rt_types`')
            ->and(mysqlBuiltinObjects($target))->toBe(mysqlBuiltinObjects($source))
            ->and((int) $target->selectOne('SELECT COUNT(*) AS n FROM rt_types')->n)->toBe(0);
    });
})->with(['mysql', 'mariadb']);

it('exports data only', function (string $engine) {
    mysqlBuiltinRoundTrip($engine, function (Connection $source, Connection $target) use ($engine) {
        // Even with drop asked for: dropping tables a data-only file never recreates would lose them.
        $path = mysqlBuiltinExport($source, $engine, mysqlBuiltinOptions(['order', 'rt_types'], structure: false, drop: true));
        try {
            $sql = (string) file_get_contents($path);
            $target->unprepared((string) $source->selectOne('SHOW CREATE TABLE `order`')->{'Create Table'});
            $target->unprepared((string) $source->selectOne('SHOW CREATE TABLE rt_types')->{'Create Table'});
            mysqlBuiltinRestore($target, $engine, $path);
        } finally {
            @unlink($path);
        }

        expect($sql)->not->toContain('CREATE')
            ->and($sql)->not->toContain('DROP')
            ->and($sql)->toContain('INSERT INTO `order`')
            ->and($target->select('SELECT * FROM `order` ORDER BY id'))->toEqual($source->select('SELECT * FROM `order` ORDER BY id'))
            ->and($target->select('SELECT * FROM rt_types ORDER BY id'))->toEqual($source->select('SELECT * FROM rt_types ORDER BY id'));
    });
})->with(['mysql', 'mariadb']);

it('adds drops only when asked', function (string $engine) {
    mysqlBuiltinRoundTrip($engine, function (Connection $source, Connection $target) use ($engine) {
        $plain = mysqlBuiltinExport($source, $engine, mysqlBuiltinOptions());
        $dropping = mysqlBuiltinExport($source, $engine, mysqlBuiltinOptions(drop: true));
        try {
            $plainSql = (string) file_get_contents($plain);
            $droppingSql = (string) file_get_contents($dropping);
            // Restoring the dropping file twice works: the second run replaces what the first created.
            mysqlBuiltinRestore($target, $engine, $dropping);
            mysqlBuiltinRestore($target, $engine, $dropping);
        } finally {
            @unlink($plain);
            @unlink($dropping);
        }

        expect($plainSql)->not->toContain('DROP ')
            ->and($droppingSql)->toContain('DROP TABLE IF EXISTS `order`;')
            ->and($droppingSql)->toContain('DROP VIEW IF EXISTS `rt_big_orders`;')
            ->and(strrpos($droppingSql, 'DROP '))->toBeLessThan(strpos($droppingSql, 'CREATE TABLE'))
            ->and(mysqlBuiltinFingerprint($engine, true))->toBe(mysqlBuiltinFingerprint($engine, false));
    });
})->with(['mysql', 'mariadb']);

it('writes invisible columns and leaves generated and system-period ones to the server', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $factory = app(ConnectionFactory::class);
    $source = $factory->make(Engines::savedConnection($engine));
    $target = $factory->make(Engines::prepareRestoreTarget($engine));

    try {
        $source->statement('DROP TABLE IF EXISTS rt_cols');
        $source->statement($engine === 'mysql'
            ? 'CREATE TABLE rt_cols (id INT NOT NULL PRIMARY KEY, hid INT NULL INVISIBLE, g INT AS (id * 2) VIRTUAL,
                s INT AS (id * 3) STORED, e INT NULL DEFAULT (id + 1), ts TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP)'
            : 'CREATE TABLE rt_cols (id INT NOT NULL PRIMARY KEY, hid INT NULL INVISIBLE, g INT AS (id * 2) VIRTUAL,
                s INT AS (id * 3) PERSISTENT, e INT NULL DEFAULT (id + 1), ts TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                rs TIMESTAMP(6) GENERATED ALWAYS AS ROW START INVISIBLE, re TIMESTAMP(6) GENERATED ALWAYS AS ROW END INVISIBLE,
                PERIOD FOR SYSTEM_TIME (rs, re)) WITH SYSTEM VERSIONING');
        // Values that differ from every default, so a left-out column shows.
        $source->insert("INSERT INTO rt_cols (id, hid, e, ts) VALUES (1, 10, 99, '2020-01-01 00:00:00'), (2, NULL, NULL, NULL)");
        // A body containing the usual ;; delimiter needs another one.
        $source->statement("CREATE TRIGGER rt_cols_semi BEFORE INSERT ON rt_cols FOR EACH ROW SET NEW.hid = COALESCE(NEW.hid, 0) + LENGTH(';;')");

        $path = mysqlBuiltinExport($source, $engine, mysqlBuiltinOptions(['rt_cols']));
        try {
            $sql = (string) file_get_contents($path);
            mysqlBuiltinRestore($target, $engine, $path);
        } finally {
            @unlink($path);
        }

        $rows = 'SELECT id, hid, g, s, e, ts FROM rt_cols ORDER BY id';
        expect($sql)->toContain('INSERT INTO `rt_cols` (`id`, `hid`, `e`, `ts`) VALUES')
            ->and($target->select($rows))->toEqual($source->select($rows))
            ->and($target->selectOne('SELECT hid FROM rt_cols WHERE id = 1')->hid)->toBe(10)
            ->and($sql)->toContain("DELIMITER \$\$\n")
            ->and($target->selectOne("SELECT action_statement AS s FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND trigger_name = 'rt_cols_semi'")?->s)
            ->toBe($source->selectOne("SELECT action_statement AS s FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND trigger_name = 'rt_cols_semi'")->s);
    } finally {
        $factory->release($target);
        $source->statement('DROP TABLE IF EXISTS rt_cols');
        $factory->release($source);
        Engines::dropRestoreTarget($engine);
    }
})->with(['mysql', 'mariadb']);

it('keeps memory flat on a big table', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $factory = app(ConnectionFactory::class);
    $db = $factory->make(Engines::savedConnection($engine));
    $path = null;

    try {
        $db->statement('DROP TABLE IF EXISTS rt_mem_big');
        $db->statement('CREATE TABLE rt_mem_big (id INT NOT NULL PRIMARY KEY, body VARCHAR(255) NOT NULL)');
        $db->statement('SET SESSION '.($engine === 'mysql' ? 'cte_max_recursion_depth' : 'max_recursive_iterations').' = 200000');
        $db->statement("INSERT INTO rt_mem_big (id, body)
            WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 200000)
            SELECT n, CONCAT(LPAD(n, 8, '0'), ' ', REPEAT(SHA2(n, 256), 3)) FROM seq");

        $progress = mysqlBuiltinProgress();
        gc_collect_cycles();
        $before = memory_get_usage();
        memory_reset_peak_usage();
        $path = mysqlBuiltinExport($db, $engine, mysqlBuiltinOptions(['rt_mem_big']), $progress);
        $growth = memory_get_peak_usage() - $before;

        expect($progress->tableRows)->toBe(['rt_mem_big' => 200_000])
            ->and(filesize($path))->toBeGreaterThan(200_000 * 200)
            ->and($growth)->toBeLessThan(32 * 1024 * 1024);
        // The connection is usable afterwards: the unbuffered cursor was fully read and buffering is back on.
        expect((int) $db->selectOne('SELECT COUNT(*) AS n FROM rt_mem_big')->n)->toBe(200_000);

        // A cancel in the middle of the rows stops the export and still leaves the session as it found it.
        $db->statement("SET time_zone = '+03:00'");
        $cancelling = new class(new Transfer) extends TransferProgress
        {
            public int $rows = 0;

            public function advance(int $bytes = 0, int $rows = 0, int $statements = 0, ?string $table = null): void
            {
                $this->rows += $rows;
            }

            public function flush(): void {}

            public function checkCancelled(): void
            {
                if ($this->rows >= 5_000) {
                    throw new TransferCancelled('Cancelled');
                }
            }
        };
        expect(fn () => mysqlBuiltinExport($db, $engine, mysqlBuiltinOptions(['rt_mem_big']), $cancelling))
            ->toThrow(TransferCancelled::class);
        expect($cancelling->rows)->toBe(5_000)
            ->and($db->selectOne('SELECT @@session.time_zone AS tz, COUNT(*) AS n FROM rt_mem_big'))->toEqual((object) ['tz' => '+03:00', 'n' => 200_000]);
    } finally {
        if ($path !== null) {
            @unlink($path);
        }
        $db->statement('DROP TABLE IF EXISTS rt_mem_big');
        $factory->release($db);
    }
})->with(['mysql', 'mariadb']);
