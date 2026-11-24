<?php

use App\Database\ConnectionFactory;
use App\Enums\DriverName;
use App\Models\Transfer;
use App\Transfers\Export\BuiltinExporters;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Export\PostgresBuiltinExporter;
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
function pgBuiltinProgress(): TransferProgress
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
function pgBuiltinOptions(?array $tables = null, bool $structure = true, bool $data = true, bool $drop = false): ExportOptions
{
    return new ExportOptions(tables: $tables, structure: $structure, data: $data, dropFirst: $drop, gzip: false);
}

function pgKey(string $schema, string $name): string
{
    return json_encode([$schema, $name], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/** Exports through the registry (as the job will) into a temp file and returns its path. */
function pgBuiltinExport(Connection $db, ExportOptions $o, ?TransferProgress $p = null): string
{
    $path = (string) tempnam(sys_get_temp_dir(), 'dbz-pg-');
    $writer = new DumpWriter($path, $o->gzip);
    try {
        app(BuiltinExporters::class)->for(DriverName::Postgres)->export($db, $o, $writer, $p ?? pgBuiltinProgress());
    } catch (Throwable $e) {
        $writer->abort();

        throw $e;
    }
    $writer->close();

    return $path;
}

/** Restores the file with BuiltinRestorer into the database $db is open on (on a connection of its own). */
function pgBuiltinRestore(Connection $db, string $path): void
{
    app(BuiltinRestorer::class)->run(Engines::savedConnection('pgsql', ['database' => $db->getDatabaseName()]), new DumpReader($path), pgBuiltinProgress());
}

/** Export into a temp file, restore it into the target, and return the file's text. */
function pgBuiltinRoundTripFile(Connection $source, Connection $target, ExportOptions $o, ?TransferProgress $p = null): string
{
    $path = pgBuiltinExport($source, $o, $p);
    try {
        $sql = (string) file_get_contents($path);
        pgBuiltinRestore($target, $path);
    } finally {
        @unlink($path);
    }

    return $sql;
}

/**
 * Sets up the fixture in dbzuper_test and an empty dbzuper_test_restore, runs the test, and always cleans both up.
 *
 * @param  Closure(Connection $source, Connection $target): mixed  $test
 */
function pgBuiltinRoundTrip(Closure $test, ?Closure $cleanup = null): void
{
    Engines::skipUnlessAvailable('pgsql');
    $factory = app(ConnectionFactory::class);
    $source = $factory->make(Engines::savedConnection('pgsql'));
    $target = $factory->make(Engines::prepareRestoreTarget('pgsql'));
    try {
        if ($cleanup !== null) {
            $cleanup($source);
        }
        TransferFixture::drop($source, 'pgsql');
        TransferFixture::create($source, 'pgsql');
        $test($source, $target);
    } finally {
        $factory->release($target);
        if ($cleanup !== null) {
            $cleanup($source);
        }
        TransferFixture::drop($source, 'pgsql');
        $factory->release($source);
        Engines::dropRestoreTarget('pgsql');
    }
}

/**
 * Fingerprint on a fresh connection, so neither side's session settings colour it.
 *
 * @param  list<string>|null  $schemas
 */
function pgBuiltinFingerprint(bool $target, ?array $schemas = TransferFixture::PG_SCHEMAS): array
{
    $saved = $target
        ? Engines::savedConnection('pgsql', ['database' => Engines::RESTORE_DATABASE])
        : Engines::savedConnection('pgsql');

    return app(ConnectionFactory::class)->using($saved, fn (Connection $db) => Fingerprint::of($db, 'pgsql', $schemas));
}

/** @return list<string> schema.name of every table, partition and view in the fixture's schemas */
function pgBuiltinRelations(Connection $db): array
{
    $names = array_map(fn ($r) => (string) $r->n, $db->select("SELECT n.nspname || '.' || c.relname || ':' || c.relkind::text AS n
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'v') AND n.nspname IN ('public', 'Sales')"));
    sort($names, SORT_STRING);

    return $names;
}

const PG_SESSION_HEADER = "SET client_encoding = 'UTF8';\n"
    ."SET standard_conforming_strings = on;\n"
    ."SET check_function_bodies = false;\n"
    ."SET xmloption = content;\n"
    ."SET client_min_messages = warning;\n"
    ."SET DateStyle = 'ISO, YMD';\n"
    ."SET IntervalStyle = 'postgres';\n"
    ."SET TimeZone = 'UTC';\n"
    ."SET extra_float_digits = 3;\n\n";

it('registers for pgsql and lists what it leaves out', function () {
    expect(app(BuiltinExporters::class)->for(DriverName::Postgres))->toBeInstanceOf(PostgresBuiltinExporter::class)
        ->and((new PostgresBuiltinExporter)->gaps())->toBe([
            'functions and procedures',
            'triggers',
            'extensions',
            'domains and composite types',
            'materialized views',
            'row-level security policies',
            'rules',
            'extended statistics',
            'foreign tables',
            'ownership and privileges',
            'other table settings (replica identity, CLUSTER ON, column storage and statistics targets)',
            'typed tables (restored as plain tables)',
        ]);
});

it('round-trips the fixture through a built-in dump', function () {
    pgBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $progress = pgBuiltinProgress();
        $sql = pgBuiltinRoundTripFile($source, $target, pgBuiltinOptions(), $progress);

        expect(pgBuiltinFingerprint(true))->toBe(pgBuiltinFingerprint(false));

        expect($sql)->toStartWith(PG_SESSION_HEADER)
            // Nothing names the source database, and the restorer owns the transaction.
            ->and($sql)->not->toContain(Engines::DATABASE)
            ->and($sql)->not->toMatch('/^(BEGIN|COMMIT|START TRANSACTION)/m')
            ->and($sql)->toContain('CREATE SCHEMA IF NOT EXISTS "Sales";')
            ->and($sql)->not->toContain('CREATE SCHEMA IF NOT EXISTS "public"')
            // An ALWAYS identity keeps its values, and generated columns are left to the server.
            ->and($sql)->toContain('INSERT INTO "Sales"."order" ("id", "we""ird", "feeling") OVERRIDING SYSTEM VALUE VALUES')
            ->and($sql)->toContain('INSERT INTO "public"."rt_order_items" ("order_id", "line_no", "qty", "price", "note") VALUES')
            // Partitions as such, the rows read once through the parent.
            ->and($sql)->toContain('PARTITION BY RANGE (id)')
            ->and($sql)->toContain('CREATE TABLE "public"."rt_measurements_low" PARTITION OF "public"."rt_measurements" FOR VALUES FROM (0) TO (100)')
            ->and($sql)->not->toContain('INSERT INTO "public"."rt_measurements_low"')
            ->and($sql)->toContain("COMMENT ON TABLE \"public\".\"rt_types\" IS 'types round trip';")
            // Foreign keys after the rows of both tables in the cycle.
            ->and(strpos($sql, 'ADD CONSTRAINT "rt_cycle_a_b_fk"'))->toBeGreaterThan(strrpos($sql, 'INSERT INTO "public"."rt_cycle_b"'));

        // The leftover schema of another test is part of an "All" backup too.
        $other = $source->selectOne("SELECT count(*) AS n FROM pg_namespace WHERE nspname = 'dbzuper_other'")->n;
        expect((int) $target->selectOne("SELECT count(*) AS n FROM pg_namespace WHERE nspname = 'dbzuper_other'")->n)->toBe((int) $other);

        $fixtureRows = ['public.rt_types' => 3, 'public.rt_floats' => 3, 'public.rt_big' => 2, 'public.rt_order_items' => 3,
            'public.rt_measurements' => 3, 'Sales.order' => 3];
        expect(array_intersect_key($progress->tableRows, $fixtureRows))->toEqual($fixtureRows)
            ->and($progress->rows)->toBe(array_sum($progress->tableRows))
            ->and($progress->cancelChecks)->toBeGreaterThan(0);
    });
});

it('does not depend on the settings of either session', function () {
    pgBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $hostile = [
            "SET TimeZone = 'America/Sao_Paulo'", "SET DateStyle = 'SQL, DMY'", "SET IntervalStyle = 'sql_standard'",
            'SET extra_float_digits = -3', 'SET search_path = "Sales"', "SET bytea_output = 'escape'",
            // Server-default style timeouts a big table would run into, and row security that would filter rows.
            "SET statement_timeout = '5s'", "SET lock_timeout = '5s'", "SET idle_in_transaction_session_timeout = '5s'", 'SET row_security = on',
        ];
        foreach ($hostile as $set) {
            $source->statement($set);
        }

        // Looks at the export's own session between two batches of rows.
        $settings = "SELECT current_setting('statement_timeout') AS st, current_setting('lock_timeout') AS lt,
            current_setting('idle_in_transaction_session_timeout') AS it, current_setting('row_security') AS rs";
        $probe = new class(new Transfer, $source, $settings) extends TransferProgress
        {
            public ?object $seen = null;

            public function __construct(Transfer $t, private readonly Connection $db, private readonly string $sql)
            {
                parent::__construct($t);
            }

            public function advance(int $bytes = 0, int $rows = 0, int $statements = 0, ?string $table = null): void
            {
                $this->seen ??= $this->db->selectOne($this->sql);
            }

            public function flush(): void {}

            public function checkCancelled(): void {}
        };
        $path = pgBuiltinExport($source, pgBuiltinOptions(), $probe);
        expect($probe->seen)->toEqual((object) ['st' => '0', 'lt' => '0', 'it' => '0', 'rs' => 'off']);

        // The reading session is left as it was found.
        expect($source->selectOne("SELECT current_setting('TimeZone') AS tz, current_setting('DateStyle') AS ds, current_setting('search_path') AS sp, current_setting('statement_timeout') AS st, current_setting('row_security') AS rs"))
            ->toEqual((object) ['tz' => 'America/Sao_Paulo', 'ds' => 'SQL, DMY', 'sp' => '"Sales"', 'st' => '5s', 'rs' => 'on']);

        // The restorer opens a session of its own, so hostile settings go on the restore database as its defaults.
        $database = Engines::RESTORE_DATABASE;
        try {
            // Inside the try: a setting that fails half-way still gets the ones before it reset.
            foreach (["TimeZone = 'Asia/Tokyo'", "DateStyle = 'German, DMY'", "IntervalStyle = 'iso_8601'",
                'standard_conforming_strings = off', 'search_path = "Sales"'] as $set) {
                $target->statement("ALTER DATABASE {$database} SET {$set}");
            }
            pgBuiltinRestore($target, $path);
        } finally {
            @unlink($path);
            $target->statement("ALTER DATABASE {$database} RESET ALL");
        }

        expect(pgBuiltinFingerprint(true))->toBe(pgBuiltinFingerprint(false));
    });
});

it('exports only chosen tables', function () {
    pgBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $sql = pgBuiltinRoundTripFile($source, $target, pgBuiltinOptions([
            pgKey('Sales', 'order'), pgKey('public', 'rt_order_items'), pgKey('public', 'rt_order_totals'), pgKey('public', 'rt_measurements'),
        ]));

        expect($sql)->not->toContain('rt_types')
            ->and($sql)->not->toContain('invoice_no')
            ->and(pgBuiltinRelations($target))->toBe([
                'Sales.order:r',
                'public.rt_measurements:p', 'public.rt_measurements_high:r', 'public.rt_measurements_low:r',
                'public.rt_order_items:r', 'public.rt_order_totals:v',
            ])
            // The enum the chosen tables use comes along.
            ->and($target->select('SELECT * FROM "Sales"."order" ORDER BY id'))->toEqual($source->select('SELECT * FROM "Sales"."order" ORDER BY id'))
            ->and($target->select('SELECT * FROM rt_measurements ORDER BY id'))->toEqual($source->select('SELECT * FROM rt_measurements ORDER BY id'))
            ->and($target->select('SELECT * FROM rt_order_totals ORDER BY order_id'))->toEqual($source->select('SELECT * FROM rt_order_totals ORDER BY order_id'));
    });
});

it('exports structure only', function () {
    pgBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $sql = pgBuiltinRoundTripFile($source, $target, pgBuiltinOptions(data: false));

        $structure = function (array $print) {
            foreach ($print['tables'] as &$table) {
                unset($table['rows'], $table['checksum']);
                foreach ($table['partitions'] as &$partition) {
                    unset($partition['rows']);
                }
            }
            unset($table, $partition);

            return [$print['schemas'], $print['tables'], $print['views'], $print['enums'], array_keys($print['sequences'])];
        };

        expect($sql)->not->toContain('INSERT INTO')
            ->and($sql)->not->toContain('setval')
            ->and($sql)->toContain('CREATE TABLE "public"."rt_types"')
            ->and($structure(pgBuiltinFingerprint(true)))->toBe($structure(pgBuiltinFingerprint(false)))
            ->and((int) $target->selectOne('SELECT COUNT(*) AS n FROM rt_types')->n)->toBe(0);
    });
});

it('exports data only', function () {
    pgBuiltinRoundTrip(function (Connection $source, Connection $target) {
        // Structure first from a structure-only file, then the data-only one (with drop asked for, which it ignores).
        $structure = pgBuiltinExport($source, pgBuiltinOptions([pgKey('Sales', 'order'), pgKey('public', 'rt_types')], data: false));
        try {
            pgBuiltinRestore($target, $structure);
        } finally {
            @unlink($structure);
        }
        $sql = pgBuiltinRoundTripFile($source, $target, pgBuiltinOptions([pgKey('Sales', 'order'), pgKey('public', 'rt_types')], structure: false, drop: true));

        expect($sql)->not->toContain('CREATE')
            ->and($sql)->not->toContain('DROP')
            ->and($sql)->toContain('INSERT INTO "Sales"."order"')
            ->and($target->select('SELECT * FROM "Sales"."order" ORDER BY id'))->toEqual($source->select('SELECT * FROM "Sales"."order" ORDER BY id'))
            ->and(pgBuiltinFingerprint(true)['tables']['public.rt_types'])->toBe(pgBuiltinFingerprint(false)['tables']['public.rt_types']);
    });
});

it('adds drops only when asked', function () {
    pgBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $plain = pgBuiltinExport($source, pgBuiltinOptions());
        $dropping = pgBuiltinExport($source, pgBuiltinOptions(drop: true));
        // CASCADE drops whatever depends on a chosen object, so the chosen set includes its dependent view.
        $chosen = pgBuiltinExport($source, pgBuiltinOptions([
            pgKey('Sales', 'order'), pgKey('public', 'rt_order_totals'), pgKey('public', 'rt_big_orders'), pgKey('public', 'rt_order_items'),
        ], drop: true));
        try {
            $plainSql = (string) file_get_contents($plain);
            $droppingSql = (string) file_get_contents($dropping);
            $chosenSql = (string) file_get_contents($chosen);
            // Restoring the dropping file twice works: the second run replaces what the first created. So does a
            // file of chosen tables, whose enum already exists in the target.
            pgBuiltinRestore($target, $dropping);
            pgBuiltinRestore($target, $dropping);
            pgBuiltinRestore($target, $chosen);
        } finally {
            @unlink($plain);
            @unlink($dropping);
            @unlink($chosen);
        }

        expect($plainSql)->not->toContain('DROP ')
            ->and($droppingSql)->toContain('DROP TABLE IF EXISTS "Sales"."order" CASCADE;')
            ->and($droppingSql)->toContain('DROP VIEW IF EXISTS "public"."rt_big_orders" CASCADE;')
            ->and($droppingSql)->toContain('DROP TYPE IF EXISTS "public"."mood";')
            ->and($chosenSql)->not->toContain('DROP TYPE')
            ->and(strrpos($droppingSql, 'DROP '))->toBeLessThan(strpos($droppingSql, 'CREATE TABLE'))
            ->and(pgBuiltinFingerprint(true))->toBe(pgBuiltinFingerprint(false));
    });
});

it('restores sequence positions', function () {
    pgBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $sql = pgBuiltinRoundTripFile($source, $target, pgBuiltinOptions());

        expect($sql)->toContain("SELECT pg_catalog.setval('\"Sales\".\"invoice_no\"', 1005, true);")
            ->and($sql)->toContain("SELECT pg_catalog.setval('\"public\".\"rt_serial_id_seq\"', 4, true);");

        // The serial was pushed past max(id) = 3, the identity is at 3, the standalone sequence at 1005 + 5.
        expect($target->selectOne("INSERT INTO rt_serial (name) VALUES ('four') RETURNING id")->id)->toBe(5)
            ->and($target->selectOne('INSERT INTO "Sales"."order" ("we""ird") VALUES (NULL) RETURNING id')->id)->toBe(4)
            ->and($target->selectOne('SELECT nextval(\'"Sales".invoice_no\') AS n')->n)->toBe(1010);
    });
});

it('keeps awkward types, partitions, inheritance and constraints exact', function () {
    $drop = function (Connection $db) {
        $db->statement('DROP VIEW IF EXISTS "Sales".rt_pg_cheap, rt_pg_checked CASCADE');
        $db->statement('DROP TABLE IF EXISTS rt_pg_types, rt_pg_events, rt_pg_parent, rt_pg_log, rt_pg_ref CASCADE');
        $db->statement('DROP SEQUENCE IF EXISTS rt_pg_shared_seq');
    };

    pgBuiltinRoundTrip(function (Connection $source, Connection $target) {
        $source->statement('CREATE TABLE rt_pg_types (
            id INTEGER GENERATED BY DEFAULT AS IDENTITY (START WITH 50 INCREMENT BY 3 MINVALUE 7 CACHE 4) PRIMARY KEY,
            cash MONEY, cashes MONEY[], span INTERVAL, n NUMERIC, f4 REAL, f8 DOUBLE PRECISION, b BIT(4), vb VARBIT,
            x XML, r INT4RANGE, tr TSTZRANGE, dr DATERANGE, uids UUID[], moods mood[], blobs BYTEA[], pt POINT,
            ip INET, net CIDR, mac MACADDR, tsv TSVECTOR, ts TIMESTAMPTZ, d DATE, t TIMETZ, ch "char",
            c_text TEXT COLLATE "C", js JSONB DEFAULT \'{"a": 1}\', up TEXT GENERATED ALWAYS AS (upper(c_text)) STORED
        )');
        $source->statement("COMMENT ON COLUMN rt_pg_types.cash IS 'what''s owed'");
        $source->statement("INSERT INTO rt_pg_types (cash, cashes, span, n, f4, f8, b, vb, x, r, tr, dr, uids, moods, blobs, pt, ip, net, mac, tsv, ts, d, t, ch, c_text) VALUES
            (-1234.56, '{1.5,2}', '1 year 2 mons -3 days 04:05:06.789', 'NaN', 'NaN', '-Infinity', B'1010', B'10101', '<a>x</a>text', '[1,5)', '[2024-01-01 10:00+05,)', 'empty',
             '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11,NULL}', '{happy,sad}', ARRAY[decode('00ff27', 'hex'), NULL], '(1.5,-2.25)', '::1/128', '10.0.0.0/8', '08:00:2b:01:02:03',
             'a:1 fat:2 cats', '0044-03-15 12:00:00+00 BC', '5874897-12-31', '23:59:59.999999-11:30', 'x', 'Zürich \\ \"q\" ''s'),
            (DEFAULT, NULL, NULL, '1e-20', 3.4028235e38, 4.9e-324, NULL, B'', NULL, NULL, NULL, '[2020-01-01,2020-02-01)', '{}', '{}', '{}', NULL, NULL, NULL, NULL, NULL, 'infinity', '-infinity', NULL, NULL, '')");

        // A list-partitioned table with a DEFAULT partition and a sub-partitioned one, its rows in three leaves.
        $source->statement('CREATE TABLE rt_pg_events (kind TEXT NOT NULL, id INTEGER NOT NULL, at DATE, PRIMARY KEY (kind, id)) PARTITION BY LIST (kind)');
        $source->statement("CREATE TABLE \"Sales\".rt_pg_events_sale PARTITION OF rt_pg_events FOR VALUES IN ('sale') PARTITION BY RANGE (id)");
        $source->statement('CREATE TABLE "Sales".rt_pg_events_sale_low PARTITION OF "Sales".rt_pg_events_sale FOR VALUES FROM (MINVALUE) TO (10)');
        $source->statement('CREATE TABLE "Sales".rt_pg_events_sale_rest PARTITION OF "Sales".rt_pg_events_sale DEFAULT');
        $source->statement('CREATE TABLE rt_pg_events_other PARTITION OF rt_pg_events DEFAULT');
        $source->statement('CREATE INDEX rt_pg_events_at ON rt_pg_events (at DESC NULLS LAST) WHERE at IS NOT NULL');
        $source->statement("COMMENT ON INDEX rt_pg_events_at IS 'by date'");
        // Partition defaults that differ from the parent's: one set, one dropped, one left as inherited.
        $source->statement('ALTER TABLE rt_pg_events ALTER COLUMN at SET DEFAULT CURRENT_DATE');
        $source->statement("ALTER TABLE rt_pg_events_other ALTER COLUMN at SET DEFAULT '2000-01-01'");
        $source->statement('ALTER TABLE "Sales".rt_pg_events_sale_low ALTER COLUMN at DROP DEFAULT');
        $source->statement("COMMENT ON CONSTRAINT rt_cycle_a_pkey ON rt_cycle_a IS 'key'");
        $source->statement("INSERT INTO rt_pg_events VALUES ('sale', 1, '2024-01-01'), ('sale', 50, NULL), ('refund', 1, '2024-02-02')");

        // Classic inheritance: rows in parent and child are each read once.
        $source->statement('CREATE TABLE rt_pg_parent (id INTEGER, note TEXT, CONSTRAINT rt_pg_parent_id CHECK (id > 0))');
        $source->statement('CREATE TABLE rt_pg_log (extra TEXT) INHERITS (rt_pg_parent)');
        $source->statement("INSERT INTO rt_pg_parent VALUES (1, 'parent')");
        $source->statement("INSERT INTO rt_pg_log VALUES (2, 'child', 'x')");

        // NOT VALID constraints over rows that break them, an unlogged table, a sequence shared through a default.
        $source->statement('CREATE SEQUENCE rt_pg_shared_seq AS SMALLINT START 3');
        $source->statement("CREATE UNLOGGED TABLE rt_pg_ref (id INTEGER PRIMARY KEY DEFAULT nextval('rt_pg_shared_seq'), parent_id INTEGER, qty INTEGER) WITH (fillfactor = 70)");
        $source->statement('INSERT INTO rt_pg_ref VALUES (1, 999, -5)');
        $source->statement('ALTER TABLE rt_pg_ref ADD CONSTRAINT rt_pg_ref_qty CHECK (qty > 0) NOT VALID');
        $source->statement('ALTER TABLE rt_pg_ref ADD CONSTRAINT rt_pg_ref_parent FOREIGN KEY (parent_id) REFERENCES rt_cycle_a (id) MATCH FULL NOT VALID');

        // Views across schemas, one WITH CHECK OPTION.
        $source->statement('CREATE VIEW rt_pg_checked AS SELECT id, qty FROM rt_pg_ref WHERE qty < 100 WITH CASCADED CHECK OPTION');
        $source->statement('CREATE VIEW "Sales".rt_pg_cheap AS SELECT c.id FROM rt_pg_checked c JOIN rt_big_orders b ON b.order_id = c.id');
        $source->statement("COMMENT ON VIEW \"Sales\".rt_pg_cheap IS 'cheap'");

        pgBuiltinRoundTripFile($source, $target, pgBuiltinOptions());

        expect(pgBuiltinFingerprint(true))->toBe(pgBuiltinFingerprint(false));
        $comments = "SELECT obj_description('rt_pg_events_at'::regclass, 'pg_class') AS i,
            (SELECT obj_description(oid, 'pg_constraint') FROM pg_constraint WHERE conname = 'rt_cycle_a_pkey') AS c,
            col_description('rt_pg_types'::regclass, 2) AS col, obj_description('\"Sales\".rt_pg_cheap'::regclass, 'pg_class') AS v";
        expect($target->selectOne($comments))->toEqual((object) ['i' => 'by date', 'c' => 'key', 'col' => "what's owed", 'v' => 'cheap']);
        $defaults = "SELECT n.nspname || '.' || c.relname || '.' || a.attname AS col, pg_get_expr(d.adbin, d.adrelid) AS def
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0
            LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
            WHERE c.relname LIKE 'rt\\_pg\\_events%' AND c.relkind IN ('r', 'p') ORDER BY (n.nspname || '.' || c.relname || '.' || a.attname) COLLATE \"C\"";
        $sourceDefaults = $source->select($defaults);
        expect($target->select($defaults))->toEqual($sourceDefaults)
            ->and(array_column($sourceDefaults, 'def', 'col'))->toMatchArray([
                'public.rt_pg_events.at' => 'CURRENT_DATE',
                'public.rt_pg_events_other.at' => "'2000-01-01'::date",
                'Sales.rt_pg_events_sale_low.at' => null,
                'Sales.rt_pg_events_sale_rest.at' => 'CURRENT_DATE',
            ]);
        $sortedRows = 'SELECT tableoid::regclass::text AS t, * FROM rt_pg_parent ORDER BY id';
        expect($target->select($sortedRows))->toEqual($source->select($sortedRows))
            ->and($target->select('SELECT tableoid::regclass::text AS t, * FROM rt_pg_events ORDER BY kind, id'))
            ->toEqual($source->select('SELECT tableoid::regclass::text AS t, * FROM rt_pg_events ORDER BY kind, id'));
        $exact = 'SELECT cash::numeric::text AS cash, cashes::numeric[]::text AS cashes, span::text, f4::text, f8::text, x::text, ts::text, t::text FROM rt_pg_types ORDER BY id';
        $target->unprepared("SET extra_float_digits = 3; SET TimeZone = 'UTC'");
        $source->unprepared("SET extra_float_digits = 3; SET TimeZone = 'UTC'");
        expect($target->select($exact))->toEqual($source->select($exact));
        // The identity sequence keeps its options and position. With CACHE 4 the inserting session took 50..59
        // from it, so the sequence itself is at 59 and any other session's next value is 62.
        expect((int) $source->selectOne('SELECT last_value FROM rt_pg_types_id_seq')->last_value)->toBe(59)
            ->and($target->selectOne('INSERT INTO rt_pg_types DEFAULT VALUES RETURNING id')->id)->toBe(62)
            ->and($target->selectOne("SELECT pg_get_serial_sequence('rt_pg_types', 'id') AS s")->s)->toBe('public.rt_pg_types_id_seq');
    }, cleanup: $drop);
});

it('keeps memory flat on a big table and cancels cleanly', function () {
    Engines::skipUnlessAvailable('pgsql');
    $factory = app(ConnectionFactory::class);
    $db = $factory->make(Engines::savedConnection('pgsql'));
    $path = null;

    try {
        $db->statement('DROP TABLE IF EXISTS rt_mem_big');
        $db->statement('CREATE TABLE rt_mem_big (id INTEGER NOT NULL PRIMARY KEY, body VARCHAR(255) NOT NULL)');
        $db->statement("INSERT INTO rt_mem_big (id, body)
            SELECT n, lpad(n::text, 8, '0') || ' ' || repeat(md5(n::text), 6) FROM generate_series(1, 200000) n");

        $progress = pgBuiltinProgress();
        gc_collect_cycles();
        $before = memory_get_usage();
        memory_reset_peak_usage();
        $path = pgBuiltinExport($db, pgBuiltinOptions([pgKey('public', 'rt_mem_big')]), $progress);
        $growth = memory_get_peak_usage() - $before;

        expect($progress->tableRows)->toBe(['public.rt_mem_big' => 200_000])
            ->and(filesize($path))->toBeGreaterThan(200_000 * 200)
            ->and($growth)->toBeLessThan(32 * 1024 * 1024);
        expect((int) $db->selectOne('SELECT COUNT(*) AS n FROM rt_mem_big')->n)->toBe(200_000);

        // A cancel in the middle of the rows stops the export and still leaves the session as it found it.
        $db->statement("SET TimeZone = 'Europe/Berlin'");
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
        expect(fn () => pgBuiltinExport($db, pgBuiltinOptions([pgKey('public', 'rt_mem_big')]), $cancelling))
            ->toThrow(TransferCancelled::class);
        expect($cancelling->rows)->toBe(6_000)
            ->and($db->selectOne("SELECT current_setting('TimeZone') AS tz, current_setting('transaction_read_only') AS ro, COUNT(*) AS n FROM rt_mem_big"))
            ->toEqual((object) ['tz' => 'Europe/Berlin', 'ro' => 'off', 'n' => 200_000]);
        // The connection is outside any transaction: a write works and stays.
        $db->statement('DELETE FROM rt_mem_big WHERE id = 1');
        expect((int) $db->selectOne('SELECT COUNT(*) AS n FROM rt_mem_big')->n)->toBe(199_999);
    } finally {
        if ($path !== null) {
            @unlink($path);
        }
        $db->statement('DROP TABLE IF EXISTS rt_mem_big');
        $factory->release($db);
    }
});

it('fails instead of backing up a table that row-level security filters', function () {
    Engines::skipUnlessAvailable('pgsql');
    $factory = app(ConnectionFactory::class);
    $admin = $factory->make(Engines::savedConnection('pgsql'));
    $role = 'dbzuper_test_rls';
    $password = bin2hex(random_bytes(12));
    $cleanup = function () use ($admin, $role) {
        $admin->statement('DROP TABLE IF EXISTS rt_pg_secret');
        if ($admin->selectOne('SELECT 1 AS x FROM pg_roles WHERE rolname = ?', [$role]) !== null) {
            $admin->statement("DROP OWNED BY {$role}");
            $admin->statement("DROP ROLE {$role}");
        }
    };

    try {
        $cleanup();
        try {
            $admin->statement("CREATE ROLE {$role} LOGIN PASSWORD '{$password}'");
        } catch (Throwable $e) {
            test()->markTestSkipped('Cannot create a throwaway role on the test server: '.$e->getMessage());
        }
        $admin->statement('CREATE TABLE rt_pg_secret (id INTEGER PRIMARY KEY, owner TEXT)');
        $admin->insert("INSERT INTO rt_pg_secret VALUES (1, 'someone'), (2, '{$role}')");
        $admin->statement('ALTER TABLE rt_pg_secret ENABLE ROW LEVEL SECURITY');
        $admin->statement('CREATE POLICY rt_pg_secret_own ON rt_pg_secret USING (owner = current_user)');
        $admin->statement("GRANT SELECT ON rt_pg_secret TO {$role}");

        $limited = $factory->make(Engines::savedConnection('pgsql', ['username' => $role, 'password' => $password]));
        try {
            // The role sees one row of two: a backup of that would be silently partial.
            expect((int) $limited->selectOne('SELECT count(*) AS n FROM rt_pg_secret')->n)->toBe(1);
            expect(fn () => pgBuiltinExport($limited, pgBuiltinOptions([pgKey('public', 'rt_pg_secret')])))
                ->toThrow(PDOException::class, 'row-level security');
            // ... and the role's session is usable afterwards, row security back on.
            expect($limited->selectOne("SELECT current_setting('row_security') AS rs, count(*) AS n FROM rt_pg_secret"))
                ->toEqual((object) ['rs' => 'on', 'n' => 1]);
        } finally {
            $factory->release($limited);
        }
    } finally {
        $cleanup();
        $factory->release($admin);
    }
});

/**
 * Runs $test on dbzuper_test with $setup applied (and the fixture dropped) and an empty dbzuper_test_restore; always
 * cleans up with $drop.
 *
 * @param  list<string>  $setup
 * @param  Closure(Connection $source, Connection $target): mixed  $test
 */
function pgBuiltinOwnTables(array $setup, string $drop, Closure $test): void
{
    Engines::skipUnlessAvailable('pgsql');
    $factory = app(ConnectionFactory::class);
    $source = $factory->make(Engines::savedConnection('pgsql'));
    $target = $factory->make(Engines::prepareRestoreTarget('pgsql'));
    try {
        TransferFixture::drop($source, 'pgsql');
        $source->unprepared($drop);
        foreach ($setup as $sql) {
            $source->unprepared($sql);
        }
        $test($source, $target);
    } finally {
        $factory->release($target);
        $source->unprepared($drop);
        $factory->release($source);
        Engines::dropRestoreTarget('pgsql');
    }
}

it('backs up structure and data per table', function () {
    pgBuiltinOwnTables([
        'CREATE TABLE a (id serial PRIMARY KEY, v text)',
        'CREATE TABLE b (id serial PRIMARY KEY, v text)',
        'CREATE TABLE c (id serial PRIMARY KEY, v text)',
        'CREATE INDEX a_v ON a (v)',
        'CREATE INDEX b_v ON b (v)',
        'CREATE INDEX c_v ON c (v)',
        "INSERT INTO a (v) VALUES ('a1'), ('a2')",
        "INSERT INTO b (v) VALUES ('b1')",
        "INSERT INTO c (v) VALUES ('c1'), ('c2'), ('c3')",
        'CREATE VIEW v AS SELECT id FROM a',
    ], 'DROP VIEW IF EXISTS v; DROP TABLE IF EXISTS a, b, c', function (Connection $source, Connection $target) {
        $o = new ExportOptions(
            tables: [pgKey('public', 'a'), pgKey('public', 'b'), pgKey('public', 'c'), pgKey('public', 'v')],
            structure: true, data: true, dropFirst: true, gzip: false,
            modes: [pgKey('public', 'a') => 'both', pgKey('public', 'b') => 'structure', pgKey('public', 'c') => 'data'],
        );
        // A data-only table goes into one that exists already, with its own sequence.
        $target->unprepared('CREATE TABLE c (id serial PRIMARY KEY, v text)');
        $sql = pgBuiltinRoundTripFile($source, $target, $o);

        expect($sql)->toStartWith(PG_SESSION_HEADER)
            ->and($sql)->toContain('CREATE TABLE "public"."a"')
            ->and($sql)->toContain('CREATE TABLE "public"."b"')
            ->and($sql)->not->toContain('CREATE TABLE "public"."c"')
            ->and($sql)->toContain('INSERT INTO "public"."a"')
            ->and($sql)->toContain('INSERT INTO "public"."c"')
            ->and($sql)->not->toContain('INSERT INTO "public"."b"')
            ->and($sql)->toContain('DROP TABLE IF EXISTS "public"."a" CASCADE;')
            ->and($sql)->toContain('DROP TABLE IF EXISTS "public"."b" CASCADE;')
            ->and($sql)->not->toContain('DROP TABLE IF EXISTS "public"."c"')
            ->and($sql)->toContain('DROP VIEW IF EXISTS "public"."v" CASCADE;')
            ->and($sql)->toContain('"public"."b_id_seq"')
            ->and($sql)->not->toContain('SEQUENCE "public"."c_id_seq"')
            ->and($sql)->not->toContain('c_v')
            ->and($sql)->toContain("SELECT pg_catalog.setval('\"public\".\"a_id_seq\"', 2, true);")
            ->and($sql)->toContain("SELECT pg_catalog.setval('\"public\".\"c_id_seq\"', 3, true);")
            ->and($sql)->not->toContain("setval('\"public\".\"b_id_seq\"'");

        $indexes = array_map(fn ($r) => (string) $r->n, $target->select("SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('a', 'b', 'c') ORDER BY 1"));
        expect(pgBuiltinRelations($target))->toBe(['public.a:r', 'public.b:r', 'public.c:r', 'public.v:v'])
            ->and($indexes)->toBe(['a_pkey', 'a_v', 'b_pkey', 'b_v', 'c_pkey'])
            ->and($target->select('SELECT * FROM a ORDER BY id'))->toEqual($source->select('SELECT * FROM a ORDER BY id'))
            ->and((int) $target->selectOne('SELECT COUNT(*) AS n FROM b')->n)->toBe(0)
            ->and($target->select('SELECT * FROM c ORDER BY id'))->toEqual($source->select('SELECT * FROM c ORDER BY id'))
            ->and($target->selectOne("INSERT INTO c (v) VALUES ('c4') RETURNING id")->id)->toBe(4);
    });
});

it("gives a partition its parent table's mode", function () {
    pgBuiltinOwnTables([
        'CREATE TABLE ps (id int NOT NULL, v text) PARTITION BY RANGE (id)',
        'CREATE TABLE ps_low PARTITION OF ps FOR VALUES FROM (0) TO (100)',
        'CREATE INDEX ps_low_v ON ps_low (v)',
        'CREATE TABLE pd (id int NOT NULL, v text) PARTITION BY RANGE (id)',
        'CREATE TABLE pd_low PARTITION OF pd FOR VALUES FROM (0) TO (100)',
        'CREATE INDEX pd_low_v ON pd_low (v)',
        "INSERT INTO ps VALUES (1, 's1'), (2, 's2')",
        "INSERT INTO pd VALUES (1, 'd1'), (2, 'd2')",
    ], 'DROP TABLE IF EXISTS ps, pd', function (Connection $source, Connection $target) {
        $o = new ExportOptions(
            tables: [pgKey('public', 'ps'), pgKey('public', 'pd')],
            structure: true, data: true, dropFirst: false, gzip: false,
            modes: [pgKey('public', 'ps') => 'structure', pgKey('public', 'pd') => 'data'],
        );
        $target->unprepared('CREATE TABLE pd (id int NOT NULL, v text) PARTITION BY RANGE (id); CREATE TABLE pd_low PARTITION OF pd FOR VALUES FROM (0) TO (100)');
        $sql = pgBuiltinRoundTripFile($source, $target, $o);

        expect($sql)->toContain('CREATE TABLE "public"."ps"')
            ->and($sql)->toContain('CREATE TABLE "public"."ps_low" PARTITION OF "public"."ps"')
            ->and($sql)->toContain('ps_low_v')
            ->and($sql)->not->toContain('INSERT INTO "public"."ps')
            ->and($sql)->not->toContain('CREATE TABLE "public"."pd')
            ->and($sql)->not->toContain('pd_low_v')
            ->and($sql)->toContain('INSERT INTO "public"."pd"')
            ->and((int) $target->selectOne('SELECT COUNT(*) AS n FROM ps_low')->n)->toBe(0)
            ->and($target->select('SELECT * FROM pd_low ORDER BY id'))->toEqual($source->select('SELECT * FROM pd_low ORDER BY id'));
    });
});

it("keeps a data-only table's foreign keys to tables it drops and recreates", function () {
    $setup = [
        'CREATE TABLE a (id int PRIMARY KEY, v text)',
        'CREATE TABLE c (id int PRIMARY KEY, a_id int CONSTRAINT c_a_fk REFERENCES a (id), v text)',
        "INSERT INTO a VALUES (1, 'a1'), (2, 'a2')",
        "INSERT INTO c VALUES (1, 1, 'c1'), (2, 2, 'c2')",
    ];
    pgBuiltinOwnTables($setup, 'DROP TABLE IF EXISTS c, a', function (Connection $source, Connection $target) use ($setup) {
        $o = new ExportOptions(
            tables: [pgKey('public', 'a'), pgKey('public', 'c')],
            structure: true, data: true, dropFirst: true, gzip: false,
            modes: [pgKey('public', 'a') => 'both', pgKey('public', 'c') => 'data'],
        );
        // The target has both tables, c's key to a included; DROP TABLE a CASCADE takes that key with it.
        $target->unprepared($setup[0].'; '.$setup[1]);
        $sql = pgBuiltinRoundTripFile($source, $target, $o);

        expect($sql)->toContain('DROP TABLE IF EXISTS "public"."a" CASCADE;')
            ->and($sql)->not->toContain('CREATE TABLE "public"."c"')
            ->and($sql)->toContain('ALTER TABLE "public"."c" ADD CONSTRAINT "c_a_fk" FOREIGN KEY (a_id) REFERENCES public.a(id)')
            ->and(strpos($sql, 'ADD CONSTRAINT "c_a_fk"'))->toBeGreaterThan(strpos($sql, 'INSERT INTO "public"."c"'))
            ->and($target->selectOne("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'c_a_fk' AND conrelid = 'public.c'::regclass")?->d)
            ->toBe('FOREIGN KEY (a_id) REFERENCES a(id)')
            ->and($target->select('SELECT * FROM a ORDER BY id'))->toEqual($source->select('SELECT * FROM a ORDER BY id'))
            ->and($target->select('SELECT * FROM c ORDER BY id'))->toEqual($source->select('SELECT * FROM c ORDER BY id'));
    });
});
