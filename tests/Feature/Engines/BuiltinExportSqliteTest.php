<?php

use App\Database\ConnectionFactory;
use App\Enums\DriverName;
use App\Enums\TransferMethod;
use App\Models\Transfer;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Export\SqliteBuiltinExporter;
use App\Transfers\Import\RestoreFilter;
use App\Transfers\Import\SqlStream;
use App\Transfers\Io\DumpReader;
use App\Transfers\Io\DumpWriter;
use App\Transfers\TransferCancelled;
use App\Transfers\TransferProgress;
use Illuminate\Database\Connection;
use Symfony\Component\Process\ExecutableFinder;
use Symfony\Component\Process\Process;
use Tests\Support\Engines;
use Tests\Support\Fingerprint;
use Tests\Support\TransferFixture;

/** Progress that remembers what the exporter reported instead of saving a Transfer row. */
function sqliteBuiltinProgress(): TransferProgress
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
function sqliteBuiltinOptions(?array $tables = null, bool $structure = true, bool $data = true, bool $drop = false): ExportOptions
{
    return new ExportOptions(tables: $tables, structure: $structure, data: $data, dropFirst: $drop, gzip: false);
}

/** Exports through the registry (as the job will) into a temp file and returns its path. */
function sqliteBuiltinExport(Connection $db, ExportOptions $o, ?TransferProgress $p = null): string
{
    $path = (string) tempnam(sys_get_temp_dir(), 'dbz-lite-');
    $writer = new DumpWriter($path, $o->gzip);
    try {
        app(BuiltinExporters::class)->for(DriverName::Sqlite)->export($db, $o, $writer, $p ?? sqliteBuiltinProgress());
    } catch (Throwable $e) {
        $writer->abort();

        throw $e;
    }
    $writer->close();

    return $path;
}

/**
 * Stand-in for Task 12's BuiltinRestorer: foreign keys off first (a no-op inside a transaction, and Laravel turns
 * them on), then the restore pipeline's stream and filter, each statement run as is.
 */
function sqliteBuiltinRestore(Connection $db, string $path): void
{
    $db->statement('PRAGMA foreign_keys = OFF');
    $filter = new RestoreFilter(DriverName::Sqlite, Engines::RESTORE_DATABASE, TransferMethod::Builtin);
    foreach ($filter->apply(SqlStream::pieces(new DumpReader($path), 'sqlite')) as $piece) {
        if ($piece->kind === 'sql') {
            $db->unprepared($piece->text);
        }
    }
}

/** @return array<string, list<string>> object names per type, from sqlite_master */
function sqliteBuiltinObjects(Connection $db): array
{
    $objects = ['table' => [], 'index' => [], 'view' => [], 'trigger' => []];
    foreach ($db->select("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type, name") as $o) {
        $objects[(string) $o->type][] = (string) $o->name;
    }

    return $objects;
}

/**
 * Sets up the fixture in the test file and a fresh restore file, runs the test, and always cleans both up.
 *
 * @param  Closure(Connection $source, Connection $target): mixed  $test
 */
function sqliteBuiltinRoundTrip(Closure $test, bool $fixture = true): void
{
    $factory = app(ConnectionFactory::class);
    $source = $factory->make(Engines::savedConnection('sqlite'));
    $target = $factory->make(Engines::prepareRestoreTarget('sqlite'));
    try {
        TransferFixture::drop($source, 'sqlite');
        if ($fixture) {
            TransferFixture::create($source, 'sqlite');
        }
        $test($source, $target);
    } finally {
        $factory->release($target);
        TransferFixture::drop($source, 'sqlite');
        $factory->release($source);
        Engines::dropRestoreTarget('sqlite');
    }
}

/** Every row with typeof() and an exact rendering of each value (var_export tells -0.0 from 0.0). */
function sqliteBuiltinRows(Connection $db, string $sql): array
{
    return array_map(
        fn (array $row) => array_map(fn ($v) => var_export($v, true), $row),
        $db->getPdo()->query($sql)->fetchAll(PDO::FETCH_ASSOC),
    );
}

it('registers for sqlite and leaves nothing out', function () {
    expect(app(BuiltinExporters::class)->for(DriverName::Sqlite))->toBeInstanceOf(SqliteBuiltinExporter::class)
        ->and((new SqliteBuiltinExporter)->gaps())->toBe([]);
});

it('round-trips the fixture through a built-in dump', function () {
    sqliteBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $progress = sqliteBuiltinProgress();
        $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(), $progress);
        try {
            $sql = (string) file_get_contents($path);
            sqliteBuiltinRestore($target, $path);
        } finally {
            @unlink($path);
        }

        expect(Fingerprint::of($target, 'sqlite'))->toBe(Fingerprint::of($source, 'sqlite'));

        // Valid for the sqlite3 CLI as is; the restore filter drops the transaction lines.
        expect($sql)->toStartWith("PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n")
            ->and($sql)->toEndWith("COMMIT;\n")
            // The INSERT trigger is created after the rows it has already run on.
            ->and(strpos($sql, 'CREATE TRIGGER rt_insert_log_mark'))->toBeGreaterThan(strrpos($sql, 'INSERT INTO "rt_insert_log"'))
            // Generated columns are left to SQLite; a rowid that no column aliases is kept.
            ->and($sql)->toContain('INSERT INTO "rt_order_items" (rowid, "order_id", "line_no", "qty", "price", "note") VALUES')
            // The AUTOINCREMENT position past max(id) comes back exactly, after the rows.
            ->and($sql)->toContain("DELETE FROM sqlite_sequence WHERE name = 'rt_types';\nINSERT INTO sqlite_sequence (name, seq) VALUES ('rt_types', 10);")
            // Views after the view they select from.
            ->and(strpos($sql, 'CREATE VIEW rt_big_orders'))->toBeGreaterThan(strpos($sql, 'CREATE VIEW rt_order_totals'))
            // Indexes after the data.
            ->and(strpos($sql, 'CREATE INDEX rt_order_items_qty_index'))->toBeGreaterThan(strrpos($sql, 'INSERT INTO '));

        expect(sqliteBuiltinObjects($target))->toBe(sqliteBuiltinObjects($source))
            ->and((int) $target->selectOne("SELECT seq FROM sqlite_sequence WHERE name = 'rt_types'")->seq)->toBe(10);
        $fixtureRows = ['rt_types' => 3, 'rt_floats' => 3, 'rt_big' => 2, 'rt_order_items' => 3, 'rt_insert_log' => 2];
        expect(array_intersect_key($progress->tableRows, $fixtureRows))->toEqual($fixtureRows)
            ->and($progress->rows)->toBe(array_sum($progress->tableRows))
            ->and($progress->cancelChecks)->toBeGreaterThan(0);
    });
});

it('writes a file the sqlite3 CLI loads as is', function () {
    // The fixture has generated columns (3.31+).
    $cli = (new ExecutableFinder)->find('sqlite3');
    $version = $cli === null ? '' : strtok(trim((new Process([$cli, '--version']))->mustRun()->getOutput()), ' ');
    if ($cli === null || version_compare((string) $version, '3.31.0', '<')) {
        test()->markTestSkipped('sqlite3 CLI 3.31+ not installed (found: '.($version ?: 'none').')');
    }

    sqliteBuiltinRoundTrip(function (Connection $source, Connection $target) use ($cli) {
        $path = sqliteBuiltinExport($source, sqliteBuiltinOptions());
        $file = (string) $target->getConfig('database');
        try {
            $process = new Process([$cli, $file]);
            $process->setInput(fopen($path, 'rb'));
            $process->mustRun();
        } finally {
            @unlink($path);
        }

        expect(Fingerprint::of($target, 'sqlite'))->toBe(Fingerprint::of($source, 'sqlite'));
    });
});

it('keeps every value with its storage class, and rowids', function () {
    sqliteBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $source->statement('DROP TABLE IF EXISTS rt_dyn');
        $source->statement('DROP TABLE IF EXISTS rt_norowid');
        $source->statement('DROP TABLE IF EXISTS "we""ird tbl"');
        try {
            // No declared type (no affinity) and declared types that a value doesn't match.
            $source->statement('CREATE TABLE rt_dyn (id INTEGER PRIMARY KEY, anyv, t TEXT, n INTEGER, r REAL)');
            $source->statement("INSERT INTO rt_dyn (id, anyv, t, n, r) VALUES
                (1, -0.0, 'text', 'not a number', 0.1),
                (2, 9e999, X'00ff', X'0102', 'abc'),
                (3, -9e999, 1.5, 2.5, 3),
                (4, 9223372036854775807, -9223372036854775808, 9223372036854775807, -9223372036854775808),
                (5, 5e-324, 1.7976931348623157e308, -2.2250738585072014e-308, 9007199254740993),
                (6, CAST(X'610062' AS TEXT), CAST(X'ff' AS TEXT), '', X''),
                (7, 0.30000000000000004, 123456789012345680000.0, 1e100, -1e-100),
                (8, NULL, NULL, NULL, NULL),
                (9, 123456789.12345679, 'x', 1e25, 1e-300)");
            // A rowid table without an INTEGER PRIMARY KEY, with gaps in its rowids; and a WITHOUT ROWID table.
            $source->statement('CREATE TABLE "we""ird tbl" ("a b" TEXT, "c""d" BLOB)');
            $source->statement("INSERT INTO \"we\"\"ird tbl\" (rowid, \"a b\", \"c\"\"d\") VALUES (5, 'x', X'00'), (9, 'y', 2), (100, NULL, 'z')");
            $source->statement('CREATE TABLE rt_norowid (k TEXT PRIMARY KEY, v) WITHOUT ROWID');
            $source->statement("INSERT INTO rt_norowid (k, v) VALUES ('b', 1), ('a', 2.5), ('c', X'ff')");

            $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(['rt_dyn', 'we"ird tbl', 'rt_norowid']));
            try {
                $sql = (string) file_get_contents($path);
                sqliteBuiltinRestore($target, $path);
            } finally {
                @unlink($path);
            }

            $typed = 'SELECT id, typeof(anyv), anyv, typeof(t), t, typeof(n), n, typeof(r), r FROM rt_dyn ORDER BY id';
            expect($sql)->toContain('INSERT INTO "we""ird tbl" (rowid, "a b", "c""d") VALUES')
                ->and($sql)->toContain('INSERT INTO "rt_norowid" ("k", "v") VALUES')
                ->and(sqliteBuiltinRows($target, $typed))->toBe(sqliteBuiltinRows($source, $typed))
                ->and(sqliteBuiltinRows($target, 'SELECT rowid, "a b", typeof("c""d"), "c""d" FROM "we""ird tbl" ORDER BY rowid'))
                ->toBe(sqliteBuiltinRows($source, 'SELECT rowid, "a b", typeof("c""d"), "c""d" FROM "we""ird tbl" ORDER BY rowid'))
                ->and(sqliteBuiltinRows($target, 'SELECT k, typeof(v), v FROM rt_norowid ORDER BY k'))
                ->toBe(sqliteBuiltinRows($source, 'SELECT k, typeof(v), v FROM rt_norowid ORDER BY k'))
                ->and($target->selectOne("SELECT sql FROM sqlite_master WHERE name = 'rt_norowid'")->sql)
                ->toBe($source->selectOne("SELECT sql FROM sqlite_master WHERE name = 'rt_norowid'")->sql);
            // Short decimals stay readable; a value SQLite's parser could misread is written as its exact binary value.
            expect($sql)->toContain("(1,-0.0,'text','not a number',0.1),")
                ->and($sql)->toMatch('~\(9,\(CAST\(\d+ AS REAL\)/\d+\),~');
            // Spot checks on what the comparison relies on.
            expect(var_export($target->getPdo()->query('SELECT anyv FROM rt_dyn WHERE id = 1')->fetchColumn(), true))->toBe('-0.0')
                ->and($target->getPdo()->query('SELECT anyv FROM rt_dyn WHERE id = 4')->fetchColumn())->toBe(PHP_INT_MAX)
                ->and($target->getPdo()->query('SELECT typeof(t) FROM rt_dyn WHERE id = 2')->fetchColumn())->toBe('blob');
        } finally {
            $source->statement('DROP TABLE IF EXISTS rt_dyn');
            $source->statement('DROP TABLE IF EXISTS rt_norowid');
            $source->statement('DROP TABLE IF EXISTS "we""ird tbl"');
        }
    }, fixture: false);
});

it('exports only chosen tables', function () {
    sqliteBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(['order', 'rt_order_items', 'rt_order_totals']));
        try {
            $sql = (string) file_get_contents($path);
            sqliteBuiltinRestore($target, $path);
        } finally {
            @unlink($path);
        }

        expect($sql)->not->toContain('rt_types')
            ->and($sql)->not->toContain('rt_insert_log')
            ->and(sqliteBuiltinObjects($target))->toBe([
                'table' => ['order', 'rt_order_items'],
                'index' => ['rt_order_items_qty_index'],
                'view' => ['rt_order_totals'],
                'trigger' => ['rt_order_items_note'],
            ])
            ->and($target->select('SELECT * FROM "order" ORDER BY id'))->toEqual($source->select('SELECT * FROM "order" ORDER BY id'));
    });
});

it('exports structure only', function () {
    sqliteBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(data: false));
        try {
            $sql = (string) file_get_contents($path);
            sqliteBuiltinRestore($target, $path);
        } finally {
            @unlink($path);
        }

        expect($sql)->not->toContain('INSERT INTO')
            ->and($sql)->not->toContain('sqlite_sequence')
            ->and($sql)->toContain('CREATE TABLE rt_types')
            ->and(sqliteBuiltinObjects($target))->toBe(sqliteBuiltinObjects($source))
            ->and((int) $target->selectOne('SELECT COUNT(*) AS n FROM rt_types')->n)->toBe(0);
    });
});

it('exports data only', function () {
    sqliteBuiltinRoundTrip(function (Connection $source, Connection $target) {
        // Even with drop asked for: dropping tables a data-only file never recreates would lose them.
        $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(['order', 'rt_types'], structure: false, drop: true));
        try {
            $sql = (string) file_get_contents($path);
            $target->unprepared((string) $source->selectOne("SELECT sql FROM sqlite_master WHERE name = 'order'")->sql);
            $target->unprepared((string) $source->selectOne("SELECT sql FROM sqlite_master WHERE name = 'rt_types'")->sql);
            sqliteBuiltinRestore($target, $path);
        } finally {
            @unlink($path);
        }

        expect($sql)->not->toContain('CREATE')
            ->and($sql)->not->toContain('DROP')
            ->and($sql)->toContain('INSERT INTO "order"')
            ->and($target->select('SELECT * FROM "order" ORDER BY id'))->toEqual($source->select('SELECT * FROM "order" ORDER BY id'))
            ->and(sqliteBuiltinRows($target, 'SELECT * FROM rt_types ORDER BY id'))->toBe(sqliteBuiltinRows($source, 'SELECT * FROM rt_types ORDER BY id'))
            ->and((int) $target->selectOne("SELECT seq FROM sqlite_sequence WHERE name = 'rt_types'")->seq)->toBe(10);
    });
});

it('adds drops only when asked', function () {
    sqliteBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $plain = sqliteBuiltinExport($source, sqliteBuiltinOptions());
        $dropping = sqliteBuiltinExport($source, sqliteBuiltinOptions(drop: true));
        try {
            $plainSql = (string) file_get_contents($plain);
            $droppingSql = (string) file_get_contents($dropping);
            // Restoring the dropping file twice works: the second run replaces what the first created.
            sqliteBuiltinRestore($target, $dropping);
            sqliteBuiltinRestore($target, $dropping);
        } finally {
            @unlink($plain);
            @unlink($dropping);
        }

        expect($plainSql)->not->toContain('DROP ')
            ->and($droppingSql)->toContain('DROP TABLE IF EXISTS "order";')
            ->and($droppingSql)->toContain('DROP VIEW IF EXISTS "rt_big_orders";')
            ->and(strrpos($droppingSql, 'DROP '))->toBeLessThan(strpos($droppingSql, 'CREATE TABLE'))
            ->and(Fingerprint::of($target, 'sqlite'))->toBe(Fingerprint::of($source, 'sqlite'));
    });
});

it('keeps memory flat on a big table and stops cleanly on cancel', function () {
    $factory = app(ConnectionFactory::class);
    $db = $factory->make(Engines::savedConnection('sqlite'));
    $path = null;

    try {
        $db->statement('DROP TABLE IF EXISTS rt_mem_big');
        $db->statement('CREATE TABLE rt_mem_big (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
        $db->statement("INSERT INTO rt_mem_big (id, body)
            WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 200000)
            SELECT n, printf('%08d ', n) || hex(randomblob(96)) FROM seq");

        $progress = sqliteBuiltinProgress();
        gc_collect_cycles();
        $before = memory_get_usage();
        memory_reset_peak_usage();
        $path = sqliteBuiltinExport($db, sqliteBuiltinOptions(['rt_mem_big']), $progress);
        $growth = memory_get_peak_usage() - $before;

        expect($progress->tableRows)->toBe(['rt_mem_big' => 200_000])
            ->and(filesize($path))->toBeGreaterThan(200_000 * 200)
            ->and($growth)->toBeLessThan(32 * 1024 * 1024)
            ->and($db->getPdo()->inTransaction())->toBeFalse();

        // A cancel in the middle of the rows stops the export and still ends the read transaction.
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
        expect(fn () => sqliteBuiltinExport($db, sqliteBuiltinOptions(['rt_mem_big']), $cancelling))
            ->toThrow(TransferCancelled::class);
        expect($cancelling->rows)->toBe(5_000)
            ->and($db->getPdo()->inTransaction())->toBeFalse()
            ->and($db->getPdo()->getAttribute(PDO::ATTR_STRINGIFY_FETCHES))->toBeFalse()
            ->and((int) $db->selectOne('SELECT COUNT(*) AS n FROM rt_mem_big')->n)->toBe(200_000);
        // Writable again: nothing still holds the file.
        $db->statement('DELETE FROM rt_mem_big WHERE id = 1');
    } finally {
        if ($path !== null) {
            @unlink($path);
        }
        $db->statement('DROP TABLE IF EXISTS rt_mem_big');
        $factory->release($db);
    }
});

it('writes any double as an expression SQLite evaluates to the very same bits', function () {
    $exact = fn (float $v): string => (fn () => self::exactReal($v))->call(new SqliteBuiltinExporter);
    $values = [0.0, -0.0, 5e-324, -5e-324, 2.2250738585072014e-308, 2.225073858507201e-308, 1.7976931348623157e308,
        -1.7976931348623157e308, 1.0, 0.1, 1e-300, 123456789.12345679, 2.0 ** 53, 2.0 ** 63, 3.0e22, 1e23];
    mt_srand(8);
    for ($i = 0; $i < 2000; $i++) {
        $v = unpack('E', pack('J', (mt_rand() << 33) ^ (mt_rand() << 2) ^ mt_rand(0, 3)))[1];
        if (is_finite($v)) {
            $values[] = $v;
        }
    }

    $pdo = new PDO('sqlite::memory:');
    foreach ($values as $v) {
        $back = $pdo->query('SELECT '.$exact($v))->fetchColumn();
        expect(is_float($back) && pack('E', $back) === pack('E', $v))->toBeTrue('not exact: '.var_export($v, true).' => '.$exact($v));
    }
});
