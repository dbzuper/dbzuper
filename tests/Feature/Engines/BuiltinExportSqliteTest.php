<?php

use App\Database\ConnectionFactory;
use App\Enums\DriverName;
use App\Models\Transfer;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Export\SqliteBuiltinExporter;
use App\Transfers\Import\BuiltinRestorer;
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

/** Restores the file with BuiltinRestorer into the file $db is open on (on a connection of its own). */
function sqliteBuiltinRestore(Connection $db, string $path): void
{
    app(BuiltinRestorer::class)->run(Engines::savedConnection('sqlite', ['database' => $db->getDatabaseName()]), new DumpReader($path), sqliteBuiltinProgress());
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

it('writes a file that survives the CLI dropping the CR of every CRLF', function () {
    // The sqlite3 CLI reads line by line and drops each line's trailing CR, inside string literals too: the fixture's
    // "line\r\ntext" came back as "line\ntext". Run without the CLI: its line handling, then the file as is via PDO.
    sqliteBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $path = sqliteBuiltinExport($source, sqliteBuiltinOptions());
        try {
            $sql = (string) file_get_contents($path);
        } finally {
            @unlink($path);
        }
        $target->getPdo()->exec(str_replace("\r\n", "\n", $sql));

        expect(Fingerprint::of($target, 'sqlite'))->toBe(Fingerprint::of($source, 'sqlite'))
            ->and($target->selectOne("SELECT hex(body) AS h FROM rt_types WHERE code = 'full'")->h)
            ->toBe(strtoupper(bin2hex("multi\nline\r\ntext\twith tab and a trailing space ")));
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

it('takes the exact path for decimals a double-rounding parser misreads', function () {
    $real = function (float $v): string {
        $exporter = new SqliteBuiltinExporter;

        return (function () use ($v) {
            $this->parse = (new PDO('sqlite::memory:'))->prepare('SELECT CAST(? AS REAL)');

            return $this->real($v);
        })->call($exporter);
    };

    // Clear of the halfway point by more than 1/64 ulp, so written as decimals.
    foreach ([0.1, 0.2, 0.7, 19.99, 12345678.1234, 0.25, 0.3, 3.5, 4.25, 0.01, 1.0, 1e20, 1e22, -2.5e-7] as $v) {
        expect($real($v))->toBe(var_export($v, true));
    }
    // Within 1/64 ulp of the halfway point between two doubles: x87 double rounding reads the first three one
    // ulp off.
    foreach ([491e-8, 982e-8, 88607e-7, 1e23] as $v) {
        expect($real($v))->toStartWith('(CAST(');
    }
});

/** @param list<string> $sql */
function sqliteBuiltinSource(Connection $db, array $sql): void
{
    foreach ($sql as $statement) {
        $db->unprepared($statement);
    }
}

const SQLITE_VTAB_SETUP = [
    'CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT)',
    "INSERT INTO docs VALUES (3, 'hello world'), (10, 'foo bar')",
    "CREATE VIRTUAL TABLE ext USING fts5(body, content='docs', content_rowid='id')",
    "INSERT INTO ext(ext) VALUES ('rebuild')",
    'CREATE VIRTUAL TABLE plain USING fts5(a)',
    "INSERT INTO plain (rowid, a) VALUES (7, 'seven'), (42, 'forty two')",
    "CREATE VIRTUAL TABLE cl USING fts5(a, content='')",
    "INSERT INTO cl (rowid, a) VALUES (5, 'contentless text')",
];

const SQLITE_VTAB_DROP = ['DROP TABLE IF EXISTS ext', 'DROP TABLE IF EXISTS plain', 'DROP TABLE IF EXISTS cl', 'DROP TABLE IF EXISTS docs'];

it('restores virtual tables through their shadow tables, rowids and indexes intact', function () {
    sqliteBuiltinRoundTrip(function (Connection $source, Connection $target) {
        try {
            sqliteBuiltinSource($source, SQLITE_VTAB_SETUP);
            // Shadow tables aren't named: choosing a virtual table brings them along.
            $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(['docs', 'ext', 'plain', 'cl'], drop: true));
            try {
                $sql = (string) file_get_contents($path);
                // Twice: the second run's DROP finds the virtual tables the first one wrote into the schema.
                sqliteBuiltinRestore($target, $path);
                sqliteBuiltinRestore($target, $path);
            } finally {
                @unlink($path);
            }

            expect($sql)->toContain("PRAGMA writable_schema=ON;\nINSERT INTO sqlite_master (type, name, tbl_name, rootpage, sql) VALUES ('table', 'ext', 'ext', 0, 'CREATE VIRTUAL TABLE ext USING fts5(body, content=''docs'', content_rowid=''id'')');")
                ->and($sql)->toContain("PRAGMA writable_schema=RESET;\n")
                ->and($sql)->toContain('INSERT INTO "plain_data"')
                ->and($sql)->not->toContain('INSERT INTO "plain" (')
                ->and($sql)->not->toContain('INSERT INTO "cl" (');

            $same = fn (string $q) => expect(sqliteBuiltinRows($target, $q))->toBe(sqliteBuiltinRows($source, $q));
            $same('SELECT rowid, a FROM plain ORDER BY rowid');
            $same("SELECT rowid, a FROM plain WHERE plain MATCH 'forty'");
            $same("SELECT rowid, body FROM ext WHERE ext MATCH 'foo'");
            $same("SELECT rowid FROM cl WHERE cl MATCH 'contentless'");
            foreach (['plain_data', 'plain_idx', 'plain_content', 'plain_docsize', 'plain_config', 'cl_data', 'cl_idx', 'cl_config'] as $shadow) {
                $same("SELECT * FROM \"{$shadow}\" ORDER BY 1, 2");
            }
            expect(sqliteBuiltinRows($target, "SELECT rowid, a FROM plain WHERE plain MATCH 'forty'"))->toBe([['rowid' => '42', 'a' => "'forty two'"]])
                ->and(sqliteBuiltinRows($target, "SELECT rowid FROM cl WHERE cl MATCH 'contentless'"))->toBe([['rowid' => '5']])
                ->and($target->selectOne('PRAGMA integrity_check')->integrity_check)->toBe('ok')
                ->and(sqliteBuiltinObjects($target))->toBe(sqliteBuiltinObjects($source));
            // The modules accept the restored storage as their own.
            $target->unprepared("INSERT INTO plain (plain) VALUES ('integrity-check')");
            $target->unprepared("INSERT INTO ext (ext) VALUES ('integrity-check')");
            $target->unprepared("INSERT INTO cl (cl) VALUES ('integrity-check')");
        } finally {
            sqliteBuiltinSource($source, SQLITE_VTAB_DROP);
        }
    }, fixture: false);
});

it('writes virtual tables as CREATE VIRTUAL TABLE when exporting structure only', function () {
    sqliteBuiltinRoundTrip(function (Connection $source, Connection $target) {
        try {
            sqliteBuiltinSource($source, SQLITE_VTAB_SETUP);
            $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(['plain'], data: false));
            try {
                $sql = (string) file_get_contents($path);
                sqliteBuiltinRestore($target, $path);
            } finally {
                @unlink($path);
            }

            expect($sql)->toContain("CREATE VIRTUAL TABLE plain USING fts5(a);\n")
                ->and($sql)->not->toContain('writable_schema')
                ->and($sql)->not->toContain('plain_data')
                ->and(sqliteBuiltinObjects($target)['table'])->toContain('plain', 'plain_data');
            $target->unprepared("INSERT INTO plain (rowid, a) VALUES (1, 'works')");
            expect($target->selectOne("SELECT rowid AS r FROM plain WHERE plain MATCH 'works'")->r)->toBe(1);
        } finally {
            sqliteBuiltinSource($source, SQLITE_VTAB_DROP);
        }
    }, fixture: false);
});

/** Writes a virtual table straight into the schema, as a database made by an SQLite with that module would hold. */
function sqliteFakeVirtual(Connection $db, string $name, string $create): void
{
    $db->unprepared('PRAGMA writable_schema=ON');
    $db->insert("INSERT INTO sqlite_master (type, name, tbl_name, rootpage, sql) VALUES ('table', ?, ?, 0, ?)", [$name, $name, $create]);
    $db->unprepared('PRAGMA writable_schema=RESET');
}

/** Removes it again without its module (DROP TABLE would need the module), then its storage tables. */
function sqliteDropFakeVirtual(Connection $db, string $name, array $shadows): void
{
    $db->unprepared('PRAGMA writable_schema=ON');
    $db->delete("DELETE FROM sqlite_master WHERE type = 'table' AND name = ?", [$name]);
    $db->unprepared('PRAGMA writable_schema=RESET');
    foreach ($shadows as $shadow) {
        $db->unprepared("DROP TABLE IF EXISTS \"{$shadow}\"");
    }
}

it('brings an rtree\'s shadow tables along even where this PHP lacks the module', function () {
    sqliteBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $shadows = ['rt_node', 'rt_rowid', 'rt_parent', 'rt_notes'];
        try {
            // rtree's own storage layout, as SQLite with rtree leaves it.
            $source->unprepared('CREATE TABLE "rt_node"(nodeno INTEGER PRIMARY KEY,data)');
            $source->unprepared('CREATE TABLE "rt_rowid"(rowid INTEGER PRIMARY KEY,nodeno)');
            $source->unprepared('CREATE TABLE "rt_parent"(nodeno INTEGER PRIMARY KEY,parentnode)');
            $source->unprepared("INSERT INTO rt_node VALUES (1, X'000000010000000900000000000000003FC000004020000000000000')");
            $source->unprepared('INSERT INTO rt_rowid VALUES (9, 1)');
            // A user table that only looks like storage: not one of rtree's suffixes.
            $source->unprepared('CREATE TABLE rt_notes (id INTEGER PRIMARY KEY, note TEXT)');
            $source->unprepared("INSERT INTO rt_notes VALUES (1, 'mine')");
            sqliteFakeVirtual($source, 'rt', 'CREATE VIRTUAL TABLE rt USING rtree(id, x0, x1)');

            $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(['rt']));
            try {
                $sql = (string) file_get_contents($path);
            } finally {
                @unlink($path);
            }

            expect($sql)->toContain("INSERT INTO sqlite_master (type, name, tbl_name, rootpage, sql) VALUES ('table', 'rt', 'rt', 0, 'CREATE VIRTUAL TABLE rt USING rtree(id, x0, x1)');")
                ->and($sql)->toContain('CREATE TABLE "rt_node"(nodeno INTEGER PRIMARY KEY,data);')
                ->and($sql)->toContain('CREATE TABLE "rt_rowid"(rowid INTEGER PRIMARY KEY,nodeno);')
                ->and($sql)->toContain('CREATE TABLE "rt_parent"(nodeno INTEGER PRIMARY KEY,parentnode);')
                ->and($sql)->toContain("INSERT INTO \"rt_node\" (\"nodeno\", \"data\") VALUES\n(1,X'000000010000000900000000000000003fc000004020000000000000');")
                ->and($sql)->toContain("INSERT INTO \"rt_rowid\" (\"rowid\", \"nodeno\") VALUES\n(9,1);")
                ->and($sql)->not->toContain('rt_notes');

            // Not swallowed either: a full backup writes it as the plain table it is, even structure only.
            $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(data: false));
            $structure = (string) file_get_contents($path);
            @unlink($path);
            expect($structure)->toContain("CREATE TABLE rt_notes (id INTEGER PRIMARY KEY, note TEXT);\n");
        } finally {
            sqliteDropFakeVirtual($source, 'rt', $shadows);
        }
    }, fixture: false);
});

it('restores a virtual table of an unknown module through all of its storage tables', function () {
    sqliteBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $shadows = ['vx_chunks', 'vx_info'];
        try {
            $source->unprepared('CREATE TABLE "vx_chunks"(id INTEGER PRIMARY KEY, v BLOB)');
            $source->unprepared('CREATE TABLE "vx_info"(k TEXT PRIMARY KEY, v) WITHOUT ROWID');
            $source->unprepared("INSERT INTO vx_chunks VALUES (4, X'0102'), (11, X'ff')");
            $source->unprepared("INSERT INTO vx_info VALUES ('dims', 2)");
            sqliteFakeVirtual($source, 'vx', 'CREATE VIRTUAL TABLE vx USING nosuchmod(dims=2)');

            $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(['vx']));
            try {
                sqliteBuiltinRestore($target, $path);
            } finally {
                @unlink($path);
            }

            $schema = "SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'vx%' ORDER BY name";
            expect(sqliteBuiltinRows($target, $schema))->toBe(sqliteBuiltinRows($source, $schema))
                ->and(sqliteBuiltinRows($target, 'SELECT * FROM vx_chunks ORDER BY id'))->toBe(sqliteBuiltinRows($source, 'SELECT * FROM vx_chunks ORDER BY id'))
                ->and(sqliteBuiltinRows($target, 'SELECT * FROM vx_info'))->toBe(sqliteBuiltinRows($source, 'SELECT * FROM vx_info'));
        } finally {
            sqliteDropFakeVirtual($source, 'vx', $shadows);
            sqliteDropFakeVirtual($target, 'vx', $shadows);
        }
    }, fixture: false);
});

it('refuses to back up a virtual table whose module and storage are both unknown', function () {
    sqliteBuiltinRoundTrip(function (Connection $source) {
        try {
            sqliteFakeVirtual($source, 'lonely', 'CREATE VIRTUAL TABLE lonely USING nosuchmod()');

            expect(fn () => sqliteBuiltinExport($source, sqliteBuiltinOptions(['lonely'])))
                ->toThrow(RuntimeException::class, "Cannot back up virtual table lonely: its module isn't available and its storage tables couldn't be identified");
            // Structure only needs no storage: the CREATE VIRTUAL TABLE is the whole of it.
            $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(['lonely'], data: false));
            expect((string) file_get_contents($path))->toContain("CREATE VIRTUAL TABLE lonely USING nosuchmod();\n");
            @unlink($path);
        } finally {
            sqliteDropFakeVirtual($source, 'lonely', []);
        }
    }, fixture: false);
});

it('keeps user tables named like shadow tables beside a loaded fts5 table', function () {
    sqliteBuiltinRoundTrip(function (Connection $source, Connection $target) {
        try {
            $source->unprepared('CREATE VIRTUAL TABLE docs USING fts5(body)');
            $source->unprepared("INSERT INTO docs (rowid, body) VALUES (3, 'hello')");
            // rtree's suffixes, but tables of the user's own beside an fts5 table.
            $source->unprepared('CREATE TABLE docs_node (id INTEGER PRIMARY KEY, label TEXT)');
            $source->unprepared('CREATE TABLE docs_parent (id INTEGER PRIMARY KEY, node_id INTEGER)');
            $source->unprepared("INSERT INTO docs_node VALUES (1, 'n1')");
            $source->unprepared('INSERT INTO docs_parent VALUES (1, 1)');

            // Structure only: the user tables are created; fts5's own storage is left to the module.
            $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(data: false));
            try {
                $structure = (string) file_get_contents($path);
                sqliteBuiltinRestore($target, $path);
            } finally {
                @unlink($path);
            }
            expect($structure)->toContain("CREATE TABLE docs_node (id INTEGER PRIMARY KEY, label TEXT);\n")
                ->and($structure)->toContain("CREATE TABLE docs_parent (id INTEGER PRIMARY KEY, node_id INTEGER);\n")
                ->and($structure)->not->toContain('docs_data')
                ->and(sqliteBuiltinObjects($target)['table'])->toContain('docs_node', 'docs_parent', 'docs_data');

            // Choosing the fts5 table brings its storage, not the user tables; choosing a user table writes its rows.
            $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(['docs']));
            $onlyDocs = (string) file_get_contents($path);
            @unlink($path);
            $path = sqliteBuiltinExport($source, sqliteBuiltinOptions(['docs', 'docs_node']));
            $withNode = (string) file_get_contents($path);
            @unlink($path);
            expect($onlyDocs)->toContain('INSERT INTO "docs_data"')
                ->and($onlyDocs)->not->toContain('docs_node')
                ->and($onlyDocs)->not->toContain('docs_parent')
                ->and($withNode)->toContain("CREATE TABLE docs_node (id INTEGER PRIMARY KEY, label TEXT);\n")
                ->and($withNode)->toContain("INSERT INTO \"docs_node\" (\"id\", \"label\") VALUES\n(1,'n1');")
                ->and($withNode)->not->toContain('docs_parent');
        } finally {
            sqliteBuiltinSource($source, ['DROP TABLE IF EXISTS docs', 'DROP TABLE IF EXISTS docs_node', 'DROP TABLE IF EXISTS docs_parent']);
        }
    }, fixture: false);
});
