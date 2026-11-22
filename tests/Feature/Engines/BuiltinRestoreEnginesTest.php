<?php

use App\Database\ConnectionFactory;
use App\Enums\DriverName;
use App\Models\SavedConnection;
use App\Models\Transfer;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Import\BuiltinRestorer;
use App\Transfers\Import\RestoreFailed;
use App\Transfers\Import\RestoreRefused;
use App\Transfers\Io\DumpReader;
use App\Transfers\Io\DumpWriter;
use App\Transfers\TransferCancelled;
use App\Transfers\TransferProgress;
use Illuminate\Database\Connection;
use Tests\Support\Engines;
use Tests\Support\Fingerprint;
use Tests\Support\TransferFixture;

/** Progress that remembers what the restorer reported; cancels at the given checkCancelled() call when asked. */
function restoreProgress(?int $cancelAt = null): TransferProgress
{
    return new class(new Transfer, $cancelAt) extends TransferProgress
    {
        public int $bytes = 0;

        public int $statements = 0;

        public int $cancelChecks = 0;

        public function __construct(Transfer $t, private readonly ?int $cancelAt)
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
            if (++$this->cancelChecks === $this->cancelAt) {
                throw new TransferCancelled('Cancelled');
            }
        }
    };
}

/** Writes SQL text to a temp file (gzip when asked) and returns its path. */
function restoreFile(string $sql, bool $gzip = false): string
{
    $path = (string) tempnam(sys_get_temp_dir(), 'dbz-restore-');
    file_put_contents($path, $gzip ? (string) gzencode($sql) : $sql);

    return $path;
}

function restoreRun(SavedConnection $target, string $path, ?TransferProgress $progress = null): int
{
    return app(BuiltinRestorer::class)->run($target, new DumpReader($path), $progress ?? restoreProgress());
}

/** Runs the test against a fresh dbzuper_test_restore and always drops it afterwards. */
function restoreInto(string $engine, Closure $test): void
{
    Engines::skipUnlessAvailable($engine);
    $target = Engines::prepareRestoreTarget($engine);
    try {
        $test($target);
    } finally {
        Engines::dropRestoreTarget($engine);
    }
}

/** @return list<string> table names in the restore target (PostgreSQL: public only) */
function restoreTables(SavedConnection $target, string $engine): array
{
    $sql = match ($engine) {
        'sqlite' => "SELECT name AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
        'pgsql' => "SELECT tablename AS n FROM pg_tables WHERE schemaname = 'public'",
        default => "SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
    };

    $names = app(ConnectionFactory::class)->using($target, fn (Connection $db) => array_map(fn ($r) => (string) $r->n, $db->select($sql)));
    sort($names, SORT_STRING); // catalog collations differ between servers

    return $names;
}

const RESTORE_BROKEN = "CREATE TABLE a(x int);\nINSERT INTO a VALUES (1);\nSELEC nonsense;\nINSERT INTO a VALUES (2);\n";

it('restores a built-in dump', function (string $engine) {
    restoreInto($engine, function (SavedConnection $target) use ($engine) {
        $factory = app(ConnectionFactory::class);
        $source = Engines::savedConnection($engine);
        $schemas = $engine === 'pgsql' ? TransferFixture::PG_SCHEMAS : null;
        $path = (string) tempnam(sys_get_temp_dir(), 'dbz-restore-');
        try {
            $factory->using($source, function (Connection $db) use ($engine, $path) {
                TransferFixture::drop($db, $engine);
                TransferFixture::create($db, $engine);
                $writer = new DumpWriter($path, true);
                app(BuiltinExporters::class)->for(DriverName::from($engine))
                    ->export($db, new ExportOptions(tables: null, structure: true, data: true, dropFirst: false, gzip: true), $writer, restoreProgress());
                $writer->close();
            });

            $progress = restoreProgress();
            $count = restoreRun($target, $path, $progress);

            // Fresh connections on both sides, so no session setting of the restore colours the comparison.
            expect($factory->using($target, fn (Connection $db) => Fingerprint::of($db, $engine, $schemas)))
                ->toBe($factory->using($source, fn (Connection $db) => Fingerprint::of($db, $engine, $schemas)))
                ->and($count)->toBeGreaterThan(10)
                ->and($progress->statements)->toBe($count)
                // Compressed file bytes, all of them.
                ->and($progress->bytes)->toBe(filesize($path))
                ->and($progress->cancelChecks)->toBe($count);
        } finally {
            @unlink($path);
            $factory->using($source, fn (Connection $db) => TransferFixture::drop($db, $engine));
        }
    });
})->with(Engines::ENGINES);

it('rolls back everything on failure', function (string $engine) {
    restoreInto($engine, function (SavedConnection $target) use ($engine) {
        $path = restoreFile(RESTORE_BROKEN);
        try {
            restoreRun($target, $path);
            $this->fail('The restore should have failed.');
        } catch (RestoreFailed $e) {
            expect($e->statementNumber)->toBe(3)
                ->and($e->snippet)->toBe('SELEC nonsense')
                ->and($e->getMessage())->toContain('syntax error');
        } finally {
            @unlink($path);
        }

        expect(restoreTables($target, $engine))->toBe([]);
    });
})->with(['pgsql', 'sqlite']);

it('rolls back when the commit itself fails on pgsql', function () {
    restoreInto('pgsql', function (SavedConnection $target) {
        $path = restoreFile(implode("\n", [
            'CREATE TABLE p (id int PRIMARY KEY);',
            'CREATE TABLE c (p_id int REFERENCES p (id) DEFERRABLE INITIALLY DEFERRED);',
            'INSERT INTO c VALUES (5);',
        ]));
        try {
            expect(fn () => restoreRun($target, $path))->toThrow(function (RestoreFailed $e) {
                // Not one statement's fault: the deferred check runs at COMMIT.
                expect($e->statementNumber)->toBe(0)
                    ->and($e->snippet)->toBe('')
                    ->and($e->getMessage())->toContain('foreign key');
            });
        } finally {
            @unlink($path);
        }

        expect(restoreTables($target, 'pgsql'))->toBe([]);
    });
});

it('reports a partial restore on mysql', function (string $engine) {
    restoreInto($engine, function (SavedConnection $target) use ($engine) {
        $path = restoreFile(RESTORE_BROKEN);
        try {
            restoreRun($target, $path);
            $this->fail('The restore should have failed.');
        } catch (RestoreFailed $e) {
            expect($e->statementNumber)->toBe(3)
                ->and($e->snippet)->toBe('SELEC nonsense')
                ->and($e->getMessage())->toContain('SQL syntax')
                ->and($e->getMessage())->not->toContain('SQLSTATE');
        } finally {
            @unlink($path);
        }

        expect(restoreTables($target, $engine))->toBe(['a'])
            ->and(app(ConnectionFactory::class)->using($target, fn (Connection $db) => $db->select('SELECT x FROM a')))->toEqual([(object) ['x' => 1]]);
    });
})->with(['mysql', 'mariadb']);

it('cuts the snippet to the first 300 characters', function () {
    restoreInto('sqlite', function (SavedConnection $target) {
        $long = 'SELEC '.str_repeat('é', 400);
        $path = restoreFile("CREATE TABLE a(x int);\n{$long};\n");
        try {
            expect(fn () => restoreRun($target, $path))->toThrow(function (RestoreFailed $e) use ($long) {
                expect($e->statementNumber)->toBe(2)
                    ->and($e->snippet)->toBe(mb_substr($long, 0, 300));
            });
        } finally {
            @unlink($path);
        }
    });
});

it('refuses read-only connections', function () {
    // A connection that can't be opened: refusing must come before any attempt.
    $readOnly = Engines::savedConnection('sqlite', ['database' => Engines::sqliteDirectory().DIRECTORY_SEPARATOR.'missing-'.bin2hex(random_bytes(4)).'.sqlite', 'read_only' => true]);
    $path = restoreFile("CREATE TABLE a(x int);\n");
    try {
        expect(fn () => restoreRun($readOnly, $path))->toThrow(RestoreRefused::class, 'This connection is read-only.');
    } finally {
        @unlink($path);
    }
});

it('restores into the open database even when the file says USE other', function () {
    restoreInto('mysql', function (SavedConnection $target) {
        $path = restoreFile("CREATE DATABASE IF NOT EXISTS `other`;\nUSE `other`;\nCREATE TABLE a (x int);\nINSERT INTO a VALUES (1);\n");
        try {
            expect(restoreRun($target, $path))->toBe(2);
        } finally {
            @unlink($path);
        }

        expect(restoreTables($target, 'mysql'))->toBe(['a']);
    });
});

it('restores a mysqldump-style file with executable comments and DELIMITER triggers', function (string $engine) {
    restoreInto($engine, function (SavedConnection $target) use ($engine) {
        restoreRun($target, base_path('tests/fixtures/transfers/mysqldump-style.sql'));

        app(ConnectionFactory::class)->using($target, function (Connection $db) use ($engine, $target) {
            expect(restoreTables($target, $engine))->toBe(['order_lines', 'orders'])
                ->and($db->select('SELECT id, order_id, note FROM order_lines ORDER BY id'))->toEqual([
                    (object) ['id' => 1, 'order_id' => 0, 'note' => 'first; with a semicolon'],
                    (object) ['id' => 2, 'order_id' => 0, 'note' => 'it\'s "quoted" -- not a comment'],
                    (object) ['id' => 3, 'order_id' => 7, 'note' => 'what? :name ?'],
                ])
                ->and($db->select('SELECT id, placed FROM orders ORDER BY id'))->toEqual([
                    (object) ['id' => 0, 'placed' => '2026-01-02'],
                    (object) ['id' => 7, 'placed' => '2026-03-04'],
                ]);

            // The trigger and the procedure came back whole and work.
            $db->insert('INSERT INTO order_lines (order_id, note) VALUES (7, NULL)');
            expect($db->selectOne('SELECT note FROM order_lines WHERE id = 4')->note)->toBe('added later')
                ->and($db->select('CALL line_count(7)'))->toEqual([(object) ['n' => 2]]);
        });
    });
})->with(['mysql', 'mariadb']);

it('keeps going after statements that return rows on mysql', function (string $engine) {
    restoreInto($engine, function (SavedConnection $target) {
        $path = restoreFile(implode("\n", [
            'CREATE TABLE a (x int);',
            'SELECT 1;',
            'DELIMITER ;;',
            'CREATE PROCEDURE two_results() BEGIN SELECT 1; SELECT 2; END;;',
            'DELIMITER ;',
            'CALL two_results();',
            'INSERT INTO a VALUES (1);',
            'SELECT * FROM a;',
            'INSERT INTO a VALUES (2);',
        ]));
        try {
            expect(restoreRun($target, $path))->toBe(7);
        } finally {
            @unlink($path);
        }

        expect(app(ConnectionFactory::class)->using($target, fn (Connection $db) => $db->select('SELECT x FROM a ORDER BY x')))
            ->toEqual([(object) ['x' => 1], (object) ['x' => 2]]);
    });
})->with(['mysql', 'mariadb']);

it('runs statements with placeholder-like text as written', function (string $engine) {
    restoreInto($engine, function (SavedConnection $target) {
        $path = restoreFile("CREATE TABLE a (s varchar(50));\nINSERT INTO a VALUES ('why? :name ?');\n");
        try {
            restoreRun($target, $path);
        } finally {
            @unlink($path);
        }

        expect(app(ConnectionFactory::class)->using($target, fn (Connection $db) => $db->selectOne('SELECT s FROM a')->s))->toBe('why? :name ?');
    });
})->with(Engines::ENGINES);

it('stops between statements when cancelled', function (string $engine) {
    restoreInto($engine, function (SavedConnection $target) use ($engine) {
        $path = restoreFile("CREATE TABLE a(x int);\nINSERT INTO a VALUES (1);\nINSERT INTO a VALUES (2);\n");
        $progress = restoreProgress(cancelAt: 2);
        try {
            expect(fn () => restoreRun($target, $path, $progress))->toThrow(TransferCancelled::class);
        } finally {
            @unlink($path);
        }

        // PostgreSQL and SQLite roll back; MySQL keeps what already ran.
        expect(restoreTables($target, $engine))->toBe(in_array($engine, ['pgsql', 'sqlite'], true) ? [] : ['a'])
            ->and($progress->statements)->toBe(1);
    });
})->with(Engines::ENGINES);

it('restores foreign-key cycles on sqlite whatever the dump says about foreign keys', function () {
    restoreInto('sqlite', function (SavedConnection $target) {
        $path = restoreFile(implode("\n", [
            'PRAGMA foreign_keys=OFF;',
            'BEGIN TRANSACTION;',
            'CREATE TABLE a (id INTEGER PRIMARY KEY, b_id INTEGER REFERENCES b(id));',
            'INSERT INTO a VALUES (1, 1);',
            'CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id));',
            'INSERT INTO b VALUES (1, 1);',
            'COMMIT;',
        ]));
        try {
            expect(restoreRun($target, $path))->toBe(5);
        } finally {
            @unlink($path);
        }

        expect(restoreTables($target, 'sqlite'))->toBe(['a', 'b']);
    });
});

it('fails and rolls back a sqlite restore that leaves a broken foreign key', function () {
    restoreInto('sqlite', function (SavedConnection $target) {
        $path = restoreFile(implode("\n", [
            'CREATE TABLE parent (id INTEGER PRIMARY KEY);',
            'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));',
            'INSERT INTO parent VALUES (1);',
            'INSERT INTO child VALUES (1, 1), (2, 99);',
        ]));
        try {
            expect(fn () => restoreRun($target, $path))->toThrow(RestoreFailed::class, 'child');
        } finally {
            @unlink($path);
        }

        expect(restoreTables($target, 'sqlite'))->toBe([]);
    });
});

it('restores an fts5 table written through writable_schema on sqlite', function () {
    restoreInto('sqlite', function (SavedConnection $target) {
        $factory = app(ConnectionFactory::class);
        $source = Engines::savedConnection('sqlite');
        $path = (string) tempnam(sys_get_temp_dir(), 'dbz-restore-');
        try {
            $factory->using($source, function (Connection $db) use ($path) {
                $db->unprepared('DROP TABLE IF EXISTS rt_docs');
                $db->unprepared('CREATE VIRTUAL TABLE rt_docs USING fts5(body)');
                $db->unprepared("INSERT INTO rt_docs (rowid, body) VALUES (3, 'hello restore'), (8, 'other words')");
                $writer = new DumpWriter($path, false);
                app(BuiltinExporters::class)->for(DriverName::Sqlite)
                    ->export($db, new ExportOptions(tables: ['rt_docs'], structure: true, data: true, dropFirst: false, gzip: false), $writer, restoreProgress());
                $writer->close();
            });
            expect((string) file_get_contents($path))->toContain('PRAGMA writable_schema=ON;');

            restoreRun($target, $path);

            $factory->using($target, function (Connection $db) {
                expect($db->select("SELECT rowid AS r FROM rt_docs WHERE rt_docs MATCH 'restore'"))->toEqual([(object) ['r' => 3]])
                    ->and($db->selectOne('PRAGMA integrity_check')->integrity_check)->toBe('ok');
                $db->insert("INSERT INTO rt_docs (body) VALUES ('after restore')");
                expect(count($db->select("SELECT rowid FROM rt_docs WHERE rt_docs MATCH 'restore'")))->toBe(2);
            });
        } finally {
            @unlink($path);
            $factory->using($source, fn (Connection $db) => $db->unprepared('DROP TABLE IF EXISTS rt_docs'));
        }
    });
});
