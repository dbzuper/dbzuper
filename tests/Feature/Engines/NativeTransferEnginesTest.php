<?php

use App\Database\ConnectionFactory;
use App\Enums\DriverName;
use App\Enums\TransferDirection;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Export\DumpObject;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Import\BuiltinRestorer;
use App\Transfers\Import\RestoreFailed;
use App\Transfers\Import\RestoreRefused;
use App\Transfers\Io\DumpReader;
use App\Transfers\Io\DumpWriter;
use App\Transfers\Native\MySqlPrivilegeProbe;
use App\Transfers\Native\NativeCommandBuilder;
use App\Transfers\Native\NativeExporter;
use App\Transfers\Native\NativeProcess;
use App\Transfers\Native\NativeRestorer;
use App\Transfers\Native\NativeToolFailed;
use App\Transfers\Native\ToolCheck;
use App\Transfers\TransferCancelled;
use App\Transfers\TransferProgress;
use Illuminate\Database\Connection;
use Tests\Support\Engines;
use Tests\Support\Fingerprint;
use Tests\Support\TransferFixture;

/** Progress that remembers what was reported; cancels at the first check once the bytes or statements were reported. */
function nativeProgress(?int $cancelAfterBytes = null, ?int $cancelAfterStatements = null): TransferProgress
{
    return new class(new Transfer, $cancelAfterBytes, $cancelAfterStatements) extends TransferProgress
    {
        public int $bytes = 0;

        public int $statements = 0;

        public int $cancelChecks = 0;

        public function __construct(Transfer $t, private readonly ?int $cancelAfterBytes, private readonly ?int $cancelAfterStatements)
        {
            parent::__construct($t);
        }

        public function advance(int $bytes = 0, int $rows = 0, int $statements = 0, ?string $table = null): void
        {
            $this->bytes += $bytes;
            $this->statements += $statements;
        }

        public function flush(): void {}

        public function checkCancelled(): void
        {
            $this->cancelChecks++;
            if (($this->cancelAfterBytes !== null && $this->bytes >= $this->cancelAfterBytes)
                || ($this->cancelAfterStatements !== null && $this->statements >= $this->cancelAfterStatements)) {
                throw new TransferCancelled('Cancelled');
            }
        }
    };
}

function nativeOptions(bool $gzip = false, ?array $tables = null): ExportOptions
{
    return new ExportOptions(tables: $tables, structure: true, data: true, dropFirst: false, gzip: $gzip);
}

function nativeTempPath(): string
{
    return (string) tempnam(sys_get_temp_dir(), 'dbz-native-');
}

/** Native export of $source into $path (the writer is closed on success). */
function nativeExport(string $engine, SavedConnection $source, string $path, ?ExportOptions $o = null, ?TransferProgress $p = null, array $objects = []): void
{
    $o ??= nativeOptions();
    $tool = Engines::nativeTool($engine, TransferDirection::Export);
    $writer = new DumpWriter($path, $o->gzip);
    app(NativeExporter::class)->run($source, $tool, $o, $objects, $writer, $p ?? nativeProgress(), []);
    $writer->close();
}

function nativeRestore(string $engine, SavedConnection $target, string $path, ?TransferProgress $p = null): int
{
    $tool = Engines::nativeTool($engine, TransferDirection::Import);

    return app(NativeRestorer::class)->run($target, $tool, new DumpReader($path), $p ?? nativeProgress());
}

/** Runs the test against a fresh dbzuper_test_restore and always drops it afterwards. */
function nativeInto(string $engine, Closure $test): void
{
    Engines::skipUnlessAvailable($engine);
    $target = Engines::prepareRestoreTarget($engine);
    try {
        $test($target);
    } finally {
        Engines::dropRestoreTarget($engine);
    }
}

/** Creates the round-trip fixture in dbzuper_test, runs the test, and always drops the fixture again. */
function nativeWithFixture(string $engine, Closure $test): void
{
    $factory = app(ConnectionFactory::class);
    $source = Engines::savedConnection($engine);
    try {
        $factory->using($source, function (Connection $db) use ($engine) {
            TransferFixture::drop($db, $engine);
            TransferFixture::create($db, $engine);
        });
        $test($source);
    } finally {
        $factory->using($source, fn (Connection $db) => TransferFixture::drop($db, $engine));
    }
}

/** @return list<string> table names in the restore target (PostgreSQL: public only) */
function nativeTables(SavedConnection $target, string $engine): array
{
    $sql = $engine === 'pgsql'
        ? "SELECT tablename AS n FROM pg_tables WHERE schemaname = 'public'"
        : "SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'";

    $names = app(ConnectionFactory::class)->using($target, fn (Connection $db) => array_map(fn ($r) => (string) $r->n, $db->select($sql)));
    sort($names, SORT_STRING);

    return $names;
}

function nativeFingerprint(SavedConnection $c, string $engine): array
{
    return app(ConnectionFactory::class)->using($c, fn (Connection $db) => Fingerprint::of($db, $engine, $engine === 'pgsql' ? TransferFixture::PG_SCHEMAS : null));
}

function nativeFileText(string $path): string
{
    $raw = (string) file_get_contents($path);

    return str_starts_with($raw, "\x1f\x8b") ? (string) gzdecode($raw) : $raw;
}

it('round-trips natively', function (string $engine) {
    nativeInto($engine, function (SavedConnection $target) use ($engine) {
        nativeWithFixture($engine, function (SavedConnection $source) use ($engine, $target) {
            $path = nativeTempPath();
            try {
                $exportProgress = nativeProgress();
                nativeExport($engine, $source, $path, nativeOptions(gzip: true), $exportProgress);

                $text = nativeFileText($path);
                expect($text)->toStartWith("-- DBZuper dump\n")
                    ->and($text)->toContain("-- Engine: {$engine}\n")
                    ->and($text)->toContain("-- Method: native\n")
                    ->and($text)->toContain("-- Database: dbzuper_test\n")
                    ->and($exportProgress->bytes)->toBeGreaterThan(TransferFixture::BIG_TEXT_BYTES)
                    ->and($exportProgress->cancelChecks)->toBeGreaterThan(0);
                if ($engine === 'pgsql') {
                    expect($text)->toContain("-- Not included: ownership and privileges\n");
                } else {
                    // rt_floats.f is a FLOAT: the header says the tool rounds it (Ruling 22), and so does gapsFor().
                    expect($text)->toContain('-- Not included: '.NativeExporter::FLOAT_GAP."\n")
                        ->and(app(NativeExporter::class)->gapsFor($source, null))->toBe([NativeExporter::FLOAT_GAP])
                        ->and(app(NativeExporter::class)->gapsFor($source, ['rt_floats']))->toBe([NativeExporter::FLOAT_GAP])
                        ->and(app(NativeExporter::class)->gapsFor($source, ['rt_big', 'order']))->toBe([]);
                }

                $progress = nativeProgress();
                $count = nativeRestore($engine, $target, $path, $progress);

                $restored = nativeFingerprint($target, $engine);
                $original = nativeFingerprint($source, $engine);
                if ($engine !== 'pgsql') {
                    // mysqldump and mariadb-dump print FLOAT (single precision) with 6 significant digits, so
                    // rt_floats.f (16777215, 1.17549435e-38) comes back rounded. DOUBLE is exact; checked below.
                    $floats = fn (SavedConnection $c) => app(ConnectionFactory::class)->using($c, fn (Connection $db) => $db->select('SELECT id, d FROM rt_floats ORDER BY id'));
                    expect($floats($target))->toEqual($floats($source))
                        ->and($text)->toContain('0.30000000000000004,16777200');
                    unset($restored['tables']['rt_floats']['checksum'], $original['tables']['rt_floats']['checksum']);
                }

                expect($restored)->toBe($original)
                    ->and($count)->toBeGreaterThan(10)
                    ->and($progress->statements)->toBe($count)
                    ->and($progress->bytes)->toBe(filesize($path));
            } finally {
                @unlink($path);
            }
        });
    });
})->with(['mysql', 'mariadb', 'pgsql']);

it('restores a native pg_dump only natively', function () {
    nativeInto('pgsql', function (SavedConnection $target) {
        nativeWithFixture('pgsql', function (SavedConnection $source) use ($target) {
            $path = nativeTempPath();
            try {
                nativeExport('pgsql', $source, $path);

                expect(fn () => app(BuiltinRestorer::class)->run($target, new DumpReader($path), nativeProgress()))
                    ->toThrow(RestoreRefused::class, 'restore it with the native method (needs psql)');
            } finally {
                @unlink($path);
            }
        });
    });
});

it('restores a built-in dump natively', function (string $engine) {
    nativeInto($engine, function (SavedConnection $target) use ($engine) {
        nativeWithFixture($engine, function (SavedConnection $source) use ($engine, $target) {
            $path = nativeTempPath();
            try {
                app(ConnectionFactory::class)->using($source, function (Connection $db) use ($engine, $path) {
                    $writer = new DumpWriter($path, false);
                    app(BuiltinExporters::class)->for(DriverName::from($engine))->export($db, nativeOptions(), $writer, nativeProgress());
                    $writer->close();
                });

                nativeRestore($engine, $target, $path);

                expect(nativeFingerprint($target, $engine))->toBe(nativeFingerprint($source, $engine));
            } finally {
                @unlink($path);
            }
        });
    });
})->with(['mysql', 'mariadb', 'pgsql']);

it('includes routines and events in a full native dump', function (string $engine) {
    nativeInto($engine, function (SavedConnection $target) use ($engine) {
        $source = Engines::savedConnection($engine);
        $root = Engines::pdo($engine);
        $path = nativeTempPath();
        try {
            $root->exec('DROP PROCEDURE IF EXISTS rt_native_proc');
            $root->exec('DROP EVENT IF EXISTS rt_native_event');
            $root->exec('CREATE PROCEDURE rt_native_proc(IN n INT) SELECT n * 2 AS doubled');
            $root->exec("CREATE EVENT rt_native_event ON SCHEDULE EVERY 1 YEAR STARTS '2037-01-01 00:00:00' DISABLE DO SELECT 1");

            expect(app(ConnectionFactory::class)->using($source, fn (Connection $db) => MySqlPrivilegeProbe::check($db, 'dbzuper_test')))
                ->toBe(['routines' => true, 'events' => true]);

            nativeExport($engine, $source, $path);
            $text = nativeFileText($path);
            expect($text)->toContain('PROCEDURE `rt_native_proc`')
                ->and($text)->toContain('EVENT `rt_native_event`')
                ->and($text)->not->toContain('-- Not included');

            nativeRestore($engine, $target, $path);

            app(ConnectionFactory::class)->using($target, function (Connection $db) {
                expect($db->select('CALL rt_native_proc(21)'))->toEqual([(object) ['doubled' => 42]])
                    ->and($db->selectOne("SELECT COUNT(*) AS n FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE() AND EVENT_NAME = 'rt_native_event'")->n)->toBe(1);
            });
        } finally {
            @unlink($path);
            $root->exec('DROP PROCEDURE IF EXISTS rt_native_proc');
            $root->exec('DROP EVENT IF EXISTS rt_native_event');
        }
    });
})->with(['mysql', 'mariadb']);

it('drops routines when the login cannot read them', function () {
    Engines::skipUnlessAvailable('mysql');
    $root = Engines::pdo('mysql');
    $password = 'Limited-pw;1"';
    $path = nativeTempPath();
    try {
        $root->exec("DROP USER IF EXISTS 'dbzuper_test_limited'@'%'");
        $root->exec('DROP PROCEDURE IF EXISTS rt_native_limited_proc');
        $root->exec('DROP TABLE IF EXISTS rt_native_limited');
        $root->exec('CREATE TABLE rt_native_limited (id INT PRIMARY KEY)');
        $root->exec('INSERT INTO rt_native_limited VALUES (1), (2)');
        $root->exec('CREATE PROCEDURE rt_native_limited_proc() SELECT 1 AS one');
        $root->exec("CREATE USER 'dbzuper_test_limited'@'%' IDENTIFIED BY ".$root->quote($password));
        // EXECUTE makes the routine visible in information_schema, but without SHOW_ROUTINE its body is NULL.
        $root->exec("GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES, EXECUTE ON dbzuper_test.* TO 'dbzuper_test_limited'@'%'");

        $limited = Engines::savedConnection('mysql', ['username' => 'dbzuper_test_limited', 'password' => $password]);
        expect(app(ConnectionFactory::class)->using($limited, fn (Connection $db) => MySqlPrivilegeProbe::check($db, 'dbzuper_test')))
            ->toBe(['routines' => false, 'events' => false]);

        nativeExport('mysql', $limited, $path);

        $text = nativeFileText($path);
        expect($text)->toContain('-- Not included: stored procedures and functions (no permission), events (no permission)')
            ->and($text)->toContain('CREATE TABLE `rt_native_limited`')
            ->and($text)->not->toContain('rt_native_limited_proc')
            ->and($text)->not->toContain($password);
    } finally {
        @unlink($path);
        $root->exec("DROP USER IF EXISTS 'dbzuper_test_limited'@'%'");
        $root->exec('DROP PROCEDURE IF EXISTS rt_native_limited_proc');
        $root->exec('DROP TABLE IF EXISTS rt_native_limited');
    }
});

it('kills the process on cancel and leaves no file', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    nativeWithFixture($engine, function (SavedConnection $source) use ($engine) {
        $path = nativeTempPath();
        $progress = nativeProgress(cancelAfterBytes: 1);
        try {
            expect(fn () => nativeExport($engine, $source, $path, nativeOptions(gzip: true), $progress))
                ->toThrow(TransferCancelled::class);
            // How much went through first depends on the transport and the tool's speed (on Windows pg_dump may finish
            // this small fixture within one poll); a quiet tool being killed in time is pinned in NativeProcessTest.
            expect(file_exists($path))->toBeFalse()
                ->and(glob(dirname($path).DIRECTORY_SEPARATOR.'.dbz-native-*'))->toBe([]);
        } finally {
            @unlink($path);
        }
    });
})->with(['mysql', 'mariadb', 'pgsql']);

it('stops a native psql restore on cancel and rolls it back', function () {
    nativeInto('pgsql', function (SavedConnection $target) {
        nativeWithFixture('pgsql', function (SavedConnection $source) use ($target) {
            $path = nativeTempPath();
            try {
                nativeExport('pgsql', $source, $path);

                // Past the CREATE TABLEs and well into the data: psql has run part of the file when it is killed.
                $progress = nativeProgress(cancelAfterStatements: 60);
                expect(fn () => nativeRestore('pgsql', $target, $path, $progress))
                    ->toThrow(TransferCancelled::class);
                expect($progress->statements)->toBe(60)
                    ->and(nativeTables($target, 'pgsql'))->toBe([]);
            } finally {
                @unlink($path);
            }
        });
    });
});

it('rolls back a failing native psql restore', function () {
    nativeInto('pgsql', function (SavedConnection $target) {
        $path = nativeTempPath();
        file_put_contents($path, "CREATE TABLE a (x int);\nINSERT INTO a VALUES (1);\nSELEC nonsense;\nINSERT INTO a VALUES (2);\n");
        try {
            expect(fn () => nativeRestore('pgsql', $target, $path))->toThrow(function (RestoreFailed $e) {
                expect($e->statementNumber)->toBe(0)
                    ->and($e->snippet)->toBe('')
                    ->and($e->getMessage())->toContain('syntax error')
                    ->and($e->getMessage())->not->toContain((string) Engines::params('pgsql')['password']);
            });
        } finally {
            @unlink($path);
        }

        expect(nativeTables($target, 'pgsql'))->toBe([]);
    });
});

it('restores a dump with USE other_db into the open database', function () {
    nativeInto('mysql', function (SavedConnection $target) {
        $path = nativeTempPath();
        file_put_contents($path, "CREATE DATABASE IF NOT EXISTS `dbzuper_test_other`;\nUSE `dbzuper_test_other`;\nCREATE TABLE a (x int);\nINSERT INTO a VALUES (1);\n");
        try {
            expect(nativeRestore('mysql', $target, $path))->toBe(2);
        } finally {
            @unlink($path);
        }

        expect(nativeTables($target, 'mysql'))->toBe(['a'])
            ->and(Engines::serverPdo('mysql')->query("SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = 'dbzuper_test_other'")->fetchColumn())->toBe(0);
    });
});

it('refuses a dump with a psql shell command and never runs it', function (int $padding) {
    nativeInto('pgsql', function (SavedConnection $target) use ($padding) {
        $marker = sys_get_temp_dir().DIRECTORY_SEPARATOR.'dbz-pwned-'.bin2hex(random_bytes(4));
        $path = nativeTempPath();
        // With padding the command comes after the first chunk: psql is already running when it is refused.
        $rows = str_repeat("INSERT INTO a VALUES ('".str_repeat('p', 990)."');\n", $padding);
        file_put_contents($path, "CREATE TABLE a (x text);\n{$rows}\\! echo pwned-%PGPASSWORD%-\$PGPASSWORD > \"{$marker}\"\nINSERT INTO a VALUES ('after');\n");
        try {
            expect(fn () => nativeRestore('pgsql', $target, $path))->toThrow(
                RestoreRefused::class,
                "This file contains psql commands DBZuper won't run (\\!). Remove them or restore with the built-in method.",
            );
            usleep(300_000);
            expect(file_exists($marker))->toBeFalse()
                ->and(nativeTables($target, 'pgsql'))->toBe([]);
        } finally {
            @unlink($path);
            @unlink($marker);
        }
    });
})->with(['at the start' => 0, 'after the first chunk' => 600]);

it('refuses a dump with a mysql system command and never runs it', function () {
    nativeInto('mysql', function (SavedConnection $target) {
        $marker = sys_get_temp_dir().DIRECTORY_SEPARATOR.'dbz-pwned-'.bin2hex(random_bytes(4));
        $path = nativeTempPath();
        file_put_contents($path, "CREATE TABLE a (x int);\nsystem echo pwned > \"{$marker}\"\nINSERT INTO a VALUES (1);\n");
        try {
            expect(fn () => nativeRestore('mysql', $target, $path))
                ->toThrow(RestoreRefused::class, "This file contains mysql client commands DBZuper won't run (system).");
            usleep(300_000);
            expect(file_exists($marker))->toBeFalse()
                ->and(nativeTables($target, 'mysql'))->toBe([]);
        } finally {
            @unlink($path);
            @unlink($marker);
        }
    });
});

it('refuses read-only connections before starting the client', function () {
    $readOnly = Engines::savedConnection('pgsql', ['read_only' => true, 'host' => '203.0.113.1']);
    $path = nativeTempPath();
    file_put_contents($path, "CREATE TABLE a (x int);\n");
    try {
        $tool = new ToolCheck(true, 'psql', 'psql-not-run', '18.0', 'psql 18.0');
        expect(fn () => app(NativeRestorer::class)->run($readOnly, $tool, new DumpReader($path), nativeProgress()))
            ->toThrow(RestoreRefused::class, 'This connection is read-only.');
    } finally {
        @unlink($path);
    }
});

it('fails with the tool message and leaves no file when the dump tool fails', function () {
    Engines::skipUnlessAvailable('pgsql');
    $source = Engines::savedConnection('pgsql');
    $missing = new DumpObject('public', 'rt_native_missing', 'table');
    $path = nativeTempPath();
    try {
        expect(fn () => nativeExport('pgsql', $source, $path, nativeOptions(tables: [$missing->key()]), objects: [$missing]))
            ->toThrow(function (NativeToolFailed $e) {
                expect($e->getMessage())->toContain('no matching tables')
                    ->and($e->getMessage())->not->toContain((string) Engines::params('pgsql')['password']);
            });
        expect(file_exists($path))->toBeFalse();
    } finally {
        @unlink($path);
    }
});

it('exports a large table completely, byte for byte what the tool writes on its own', function () {
    Engines::skipUnlessAvailable('pgsql');
    $root = Engines::pdo('pgsql');
    $tool = Engines::nativeTool('pgsql', TransferDirection::Export);
    $dir = sys_get_temp_dir().DIRECTORY_SEPARATOR.'dbz-native-big-'.bin2hex(random_bytes(4));
    mkdir($dir);
    $path = $dir.DIRECTORY_SEPARATOR.'export.sql';
    $direct = $dir.DIRECTORY_SEPARATOR.'direct.sql';
    $table = new DumpObject('dbz_native_big', 'rows', 'table');
    $options = nativeOptions(tables: [$table->key()]);
    try {
        $root->exec('DROP SCHEMA IF EXISTS dbz_native_big CASCADE');
        $root->exec('CREATE SCHEMA dbz_native_big');
        $root->exec('CREATE TABLE dbz_native_big.rows AS SELECT g AS id, md5(g::text) AS a, repeat(md5((g * 7)::text), 3) AS b FROM generate_series(1, 300000) g');

        $source = Engines::savedConnection('pgsql');
        $writer = new DumpWriter($path, false);
        app(NativeExporter::class)->run($source, $tool, $options, [$table], $writer, nativeProgress(), []);
        $writer->close();

        // The same dump straight from pg_dump into a file, for comparison.
        $command = NativeCommandBuilder::dump($source, $tool, $options, [$table], false, false, $direct);
        $exit = (new NativeProcess($command, (string) $source->password))->run(null, fn () => null);

        $exported = (string) file_get_contents($path);
        $start = strpos($exported, "--\n-- PostgreSQL database dump\n");
        $body = substr($exported, (int) $start);
        expect($exit)->toBe(0)
            ->and($start)->toBeInt()
            ->and(strlen($body))->toBeGreaterThan(30_000_000)
            ->and(strlen($body))->toBe(filesize($direct))
            ->and(NativeExporter::hasTrailer('pg_dump', substr($body, -8192)))->toBeTrue()
            // The Windows transport's temporary output file is gone.
            ->and(glob($dir.DIRECTORY_SEPARATOR.'.dbz-native-*'))->toBe([]);
        fwrite(STDERR, sprintf("[native-big] %d bytes exported, %d bytes from pg_dump --file\n", strlen($body), filesize($direct)));
    } finally {
        $root->exec('DROP SCHEMA IF EXISTS dbz_native_big CASCADE');
        foreach (glob($dir.DIRECTORY_SEPARATOR.'{,.}*', GLOB_BRACE) ?: [] as $f) {
            if (is_file($f)) {
                @unlink($f);
            }
        }
        @rmdir($dir);
    }
});

it('leaves no temporary output file behind when the dump fails or is cancelled', function () {
    Engines::skipUnlessAvailable('pgsql');
    $dir = sys_get_temp_dir().DIRECTORY_SEPARATOR.'dbz-native-tmp-'.bin2hex(random_bytes(4));
    mkdir($dir);
    $missing = new DumpObject('public', 'rt_native_missing', 'table');
    try {
        expect(fn () => nativeExport('pgsql', Engines::savedConnection('pgsql'), $dir.DIRECTORY_SEPARATOR.'a.sql', nativeOptions(tables: [$missing->key()]), objects: [$missing]))
            ->toThrow(NativeToolFailed::class);
        expect(fn () => nativeExport('pgsql', Engines::savedConnection('pgsql'), $dir.DIRECTORY_SEPARATOR.'b.sql', nativeOptions(), nativeProgress(cancelAfterBytes: 1)))
            ->toThrow(TransferCancelled::class);
        expect(glob($dir.DIRECTORY_SEPARATOR.'{,.}*.sql', GLOB_BRACE))->toBe([]);
    } finally {
        foreach (glob($dir.DIRECTORY_SEPARATOR.'{,.}*', GLOB_BRACE) ?: [] as $f) {
            if (is_file($f)) {
                @unlink($f);
            }
        }
        @rmdir($dir);
    }
});

it('backs up a covered mix of tables natively, structure for one and data for the other', function (string $engine) {
    nativeInto($engine, function (SavedConnection $target) use ($engine) {
        nativeWithFixture($engine, function (SavedConnection $source) use ($engine, $target) {
            $factory = app(ConnectionFactory::class);
            // A chosen view on a chosen table, and a trigger on an unchosen table (the fixture's views are unchosen).
            $factory->using($source, function (Connection $db) use ($engine) {
                $db->statement('CREATE VIEW rt_mix_view AS SELECT id FROM rt_floats');
                if ($engine === 'pgsql') {
                    $db->statement('CREATE FUNCTION rt_mix_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$');
                    $db->statement('CREATE TRIGGER rt_mix_unchosen BEFORE UPDATE ON rt_order_items FOR EACH ROW EXECUTE FUNCTION rt_mix_touch()');
                } else {
                    $db->statement('CREATE TRIGGER rt_mix_unchosen BEFORE UPDATE ON rt_order_items FOR EACH ROW SET NEW.qty = NEW.qty');
                }
            });
            $schema = $engine === 'pgsql' ? 'public' : null;
            $a = new DumpObject($schema, 'rt_floats', 'table');
            $second = $engine === 'pgsql' ? 'rt_serial' : 'rt_insert_log';
            $b = new DumpObject($schema, $second, 'table');
            $view = new DumpObject($schema, 'rt_mix_view', 'view');
            $options = new ExportOptions(
                tables: [$a->key(), $b->key(), $view->key()],
                structure: true,
                data: true,
                dropFirst: false,
                gzip: false,
                modes: [$a->key() => 'both', $b->key() => 'structure'],
            );
            $path = nativeTempPath();
            try {
                nativeExport($engine, $source, $path, $options, objects: [$a, $b, $view]);

                $text = nativeFileText($path);
                $rowsOf = fn (string $table) => $engine === 'pgsql'
                    ? preg_match('/^COPY public\.'.$table.' /m', $text)
                    : preg_match('/^INSERT INTO `'.$table.'` /m', $text);
                expect($text)->toContain("-- Method: native\n")
                    ->and($text)->toMatch('/CREATE TABLE (public\.)?`?rt_floats`?/')
                    ->and($text)->toMatch('/CREATE TABLE (public\.)?`?'.$second.'`?/')
                    ->and($rowsOf('rt_floats'))->toBe(1)
                    ->and($rowsOf($second))->toBe(0)
                    ->and($text)->toContain('rt_mix_view')
                    ->and($text)->not->toContain('rt_order_items')
                    ->and($text)->not->toContain('rt_order_totals')
                    ->and($text)->not->toContain('rt_big_orders')
                    ->and($text)->not->toContain('rt_mix_unchosen');

                nativeRestore($engine, $target, $path);

                expect(nativeTables($target, $engine))->toBe(['rt_floats', $second]);
                $factory->using($target, function (Connection $db) use ($second, $engine) {
                    $views = array_map(fn ($r) => (string) $r->n, $db->select($engine === 'pgsql'
                        ? "SELECT viewname AS n FROM pg_views WHERE schemaname = 'public'"
                        : 'SELECT table_name AS n FROM information_schema.views WHERE table_schema = DATABASE()'));
                    expect($views)->toBe(['rt_mix_view'])
                        ->and($db->table('rt_floats')->count())->toBeGreaterThan(0)
                        ->and($db->table('rt_mix_view')->count())->toBeGreaterThan(0)
                        ->and($db->table($second)->count())->toBe(0);
                });
            } finally {
                @unlink($path);
                $factory->using($source, function (Connection $db) use ($engine) {
                    $db->statement('DROP VIEW IF EXISTS rt_mix_view');
                    $db->statement('DROP TRIGGER IF EXISTS rt_mix_unchosen'.($engine === 'pgsql' ? ' ON rt_order_items' : ''));
                    if ($engine === 'pgsql') {
                        $db->statement('DROP FUNCTION IF EXISTS rt_mix_touch()');
                    }
                });
            }
        });
    });
})->with(['mariadb', 'pgsql']);
