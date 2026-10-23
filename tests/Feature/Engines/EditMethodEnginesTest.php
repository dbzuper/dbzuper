<?php

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Editing\EditMethod;
use App\Database\Editing\EditMethodResolver;
use App\Database\Editing\EditPlan;
use App\Models\SavedConnection;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

afterEach(fn () => Engines::resetSqlite());

const EDIT_METHOD_TABLES = ['em_inh_child', 'em_inh_parent', 'em_part', 'em_pk', 'em_unique', 'em_bare', 'em_generated', 'em_norowid', 'em_partial', 'em_expr', 'em_invalid', 'em_deferred', 'em_ts_pk', 'em_ts_unique'];

function editMethodDrop(Connection $db): void
{
    foreach (EDIT_METHOD_TABLES as $table) {
        $db->statement('DROP TABLE IF EXISTS '.$table.($db->getDriverName() === 'pgsql' ? ' CASCADE' : ''));
    }
}

/** @return array<string, EditPlan> keyed by table name, resolved from a real snapshot */
function editPlans(SavedConnection $saved, Connection $db): array
{
    $snapshot = app(DriverRegistry::class)->for($saved->driver)->inspector()->inspect($db, $saved)->toArray();
    $resolver = new EditMethodResolver;
    $plans = [];
    foreach ($snapshot['tables'] as $table) {
        if (in_array($table['name'], EDIT_METHOD_TABLES, true)) {
            $plans[$table['name']] = $resolver->resolve($saved, $table, $db);
        }
    }

    return $plans;
}

it('decides how rows are pinned on every engine', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        editMethodDrop($db);
        $generated = match ($engine) {
            'pgsql' => 'total INT GENERATED ALWAYS AS (qty * 2) STORED',
            default => 'total INT GENERATED ALWAYS AS (qty * 2) VIRTUAL',
        };
        $db->statement('CREATE TABLE em_pk (a INT NOT NULL, b INT NOT NULL, note VARCHAR(20), PRIMARY KEY (b, a))');
        $db->statement('CREATE TABLE em_unique (code VARCHAR(20) NOT NULL, other INT NULL, note VARCHAR(20))');
        $db->statement('CREATE UNIQUE INDEX em_unique_z_other ON em_unique (other)');
        $db->statement('CREATE UNIQUE INDEX em_unique_m_code ON em_unique (code)');
        $db->statement('CREATE TABLE em_bare (note VARCHAR(20), qty INT)');
        $db->statement("CREATE TABLE em_generated (id INT NOT NULL PRIMARY KEY, qty INT, {$generated})");

        $plans = editPlans($saved, $db);

        expect($plans['em_pk']->method)->toBe(EditMethod::PrimaryKey)
            ->and($plans['em_pk']->keyColumns)->toBe(['b', 'a'])
            ->and($plans['em_unique']->method)->toBe(EditMethod::UniqueIndex)
            ->and($plans['em_unique']->keyColumns)->toBe(['code'])
            ->and($plans['em_bare']->method)->toBe(match ($engine) {
                'sqlite' => EditMethod::SqliteRowid,
                'pgsql' => EditMethod::PgCtid,
                default => EditMethod::MysqlAllValues,
            })
            ->and($plans['em_bare']->keyColumns)->toBe([])
            ->and($plans['em_generated']->method)->toBe(EditMethod::PrimaryKey)
            ->and($plans['em_generated']->readOnlyColumns)->toBe(['total'])
            ->and($plans['em_pk']->readOnlyColumns)->toBe([]);
    } finally {
        editMethodDrop($db);
        $factory->release($db);
    }
})->with(Engines::ENGINES);

it('never pins rows by a TIMESTAMP key on mysql and mariadb (ambiguous in a DST fall-back hour)', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        editMethodDrop($db);
        $db->statement('CREATE TABLE em_ts_pk (at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, code VARCHAR(20) NOT NULL, note VARCHAR(20), PRIMARY KEY (at))');
        $db->statement('CREATE UNIQUE INDEX em_ts_pk_code ON em_ts_pk (code)');
        $db->statement('CREATE TABLE em_ts_unique (at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, note VARCHAR(20))');
        $db->statement('CREATE UNIQUE INDEX em_ts_unique_at ON em_ts_unique (at)');
        $plans = editPlans($saved, $db);

        $mysql = in_array($engine, ['mysql', 'mariadb'], true);
        expect($plans['em_ts_pk']->method)->toBe($mysql ? EditMethod::UniqueIndex : EditMethod::PrimaryKey)
            ->and($plans['em_ts_pk']->keyColumns)->toBe($mysql ? ['code'] : ['at'])
            ->and($plans['em_ts_unique']->method)->toBe(match ($engine) {
                'mysql', 'mariadb' => EditMethod::MysqlAllValues,
                default => EditMethod::UniqueIndex,
            });
    } finally {
        editMethodDrop($db);
        $factory->release($db);
    }
})->with(Engines::ENGINES);

it('refuses everything on a read-only connection', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        editMethodDrop($db);
        $db->statement('CREATE TABLE em_pk (a INT NOT NULL PRIMARY KEY)');
        $saved->read_only = true;
        $plan = editPlans($saved, $db)['em_pk'];

        expect($plan->method)->toBe(EditMethod::None)
            ->and($plan->reason)->toBe('this connection is read-only');
    } finally {
        editMethodDrop($db);
        $factory->release($db);
    }
})->with(Engines::ENGINES);

it('uses the key of a SQLite WITHOUT ROWID table and skips partial unique indexes', function () {
    $saved = Engines::savedConnection('sqlite');
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        $db->statement('CREATE TABLE em_norowid (k TEXT NOT NULL PRIMARY KEY, v INT) WITHOUT ROWID');
        $db->statement('CREATE TABLE em_partial (a INT NOT NULL, b INT)');
        $db->statement('CREATE UNIQUE INDEX em_partial_a ON em_partial (a) WHERE b IS NOT NULL');
        $db->statement('CREATE TABLE em_bare (rowid INT, _rowid_ INT, oid INT)');
        $plans = editPlans($saved, $db);

        expect($plans['em_norowid']->method)->toBe(EditMethod::PrimaryKey)
            ->and($plans['em_norowid']->keyColumns)->toBe(['k'])
            ->and($plans['em_partial']->method)->toBe(EditMethod::SqliteRowid)
            ->and($plans['em_bare']->method)->toBe(EditMethod::None);
    } finally {
        editMethodDrop($db);
        $factory->release($db);
    }
});

it('skips partial unique indexes and lists identity-always columns as read-only on pgsql', function () {
    Engines::skipUnlessAvailable('pgsql');
    $saved = Engines::savedConnection('pgsql');
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        editMethodDrop($db);
        $db->statement('CREATE TABLE em_partial (a INT NOT NULL, b INT)');
        $db->statement('CREATE UNIQUE INDEX em_partial_a ON em_partial (a) WHERE b IS NOT NULL');
        $db->statement('CREATE TABLE em_generated (id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, n INT GENERATED BY DEFAULT AS IDENTITY, blob BYTEA)');
        $plans = editPlans($saved, $db);

        expect($plans['em_partial']->method)->toBe(EditMethod::PgCtid)
            ->and($plans['em_generated']->readOnlyColumns)->toBe(['id', 'blob']);
    } finally {
        editMethodDrop($db);
        $factory->release($db);
    }
});

it('does not mistake expression defaults for generated columns on mysql and mariadb', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        editMethodDrop($db);
        $db->statement('CREATE TABLE em_generated (id INT NOT NULL PRIMARY KEY, at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, s VARCHAR(40) DEFAULT (UUID()), total INT AS (id + 1) STORED, photo VARBINARY(10))');
        expect(editPlans($saved, $db)['em_generated']->readOnlyColumns)->toBe(['total', 'photo']);
    } finally {
        editMethodDrop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb']);

it('skips a unique index mixing a column and an expression', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        editMethodDrop($db);
        $db->statement('CREATE TABLE em_expr (a INT NOT NULL, b VARCHAR(20) NOT NULL)');
        $db->statement($engine === 'mysql'
            ? 'CREATE UNIQUE INDEX em_expr_u ON em_expr (a, (lower(b)))'
            : 'CREATE UNIQUE INDEX em_expr_u ON em_expr (a, lower(b))');
        $db->statement("INSERT INTO em_expr VALUES (1, 'x'), (1, 'y')");

        expect(editPlans($saved, $db)['em_expr']->method)->toBe(match ($engine) {
            'sqlite' => EditMethod::SqliteRowid,
            'pgsql' => EditMethod::PgCtid,
            default => EditMethod::MysqlAllValues,
        });
    } finally {
        editMethodDrop($db);
        $factory->release($db);
    }
})->with(['sqlite', 'mysql', 'pgsql']); // MariaDB has no functional key parts (it indexes virtual columns instead).

it('skips invalid and deferrable unique indexes on pgsql', function () {
    Engines::skipUnlessAvailable('pgsql');
    $saved = Engines::savedConnection('pgsql');
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        editMethodDrop($db);
        $db->statement('CREATE TABLE em_invalid (a INT NOT NULL)');
        $db->statement('INSERT INTO em_invalid VALUES (1), (1)');
        try {
            // Fails on the duplicate and leaves an invalid index behind.
            $db->statement('CREATE UNIQUE INDEX CONCURRENTLY em_invalid_a ON em_invalid (a)');
        } catch (Throwable) {
        }
        expect($db->selectOne("select indisvalid from pg_index where indexrelid = 'em_invalid_a'::regclass")->indisvalid)->toBeFalse();
        $db->statement('CREATE TABLE em_deferred (a INT NOT NULL, CONSTRAINT em_deferred_a UNIQUE (a) DEFERRABLE INITIALLY DEFERRED)');
        $plans = editPlans($saved, $db);

        expect($plans['em_invalid']->method)->toBe(EditMethod::PgCtid)
            ->and($plans['em_deferred']->method)->toBe(EditMethod::PgCtid);
    } finally {
        editMethodDrop($db);
        $factory->release($db);
    }
});

it('flags partitioned and inherited pgsql tables as needing tableoid', function () {
    Engines::skipUnlessAvailable('pgsql');
    $saved = Engines::savedConnection('pgsql');
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        editMethodDrop($db);
        $db->statement('DROP TABLE IF EXISTS em_part_1');
        $db->statement('CREATE TABLE em_part (n INT, v TEXT) PARTITION BY RANGE (n)');
        $db->statement('CREATE TABLE em_part_1 PARTITION OF em_part FOR VALUES FROM (0) TO (100)');
        $db->statement('CREATE TABLE em_inh_parent (v TEXT)');
        $db->statement('CREATE TABLE em_inh_child (w INT) INHERITS (em_inh_parent)');
        $db->statement('CREATE TABLE em_bare (v TEXT)');
        $plans = editPlans($saved, $db);

        expect($plans['em_part']->method)->toBe(EditMethod::PgCtid)
            ->and($plans['em_part']->needsTableoid)->toBeTrue()
            ->and($plans['em_inh_parent']->needsTableoid)->toBeTrue()
            ->and($plans['em_inh_child']->needsTableoid)->toBeFalse()
            ->and($plans['em_bare']->needsTableoid)->toBeFalse()
            ->and($plans['em_bare']->toArray()['needs_tableoid'])->toBeFalse();
    } finally {
        editMethodDrop($db);
        $factory->release($db);
    }
});
