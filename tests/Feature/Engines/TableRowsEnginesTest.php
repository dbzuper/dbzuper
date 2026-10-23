<?php

use App\Database\ConnectionFactory;
use App\Models\User;
use App\Support\Demo\CommerceSchema;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

it('filters rows with LIKE on every engine', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        CommerceSchema::drop($db);
        CommerceSchema::create($db);
        $db->table('audit_log')->update(['payload' => str_repeat('x', 5000)]);
        $factory->release($db);
        $user = $saved->user;
        $rows = fn (string $table, array $body) => $this->actingAs($user)->postJson(route('api.tables.rows', [$saved, $table]), $body);

        // users.id is an integer: PostgreSQL needs the text cast for LIKE.
        $rows('users', ['filters' => [['column' => 'id', 'op' => 'contains', 'value' => '1']]])->assertOk()->assertJsonCount(1, 'rows');
        $rows('users', ['filters' => [['column' => 'name', 'op' => 'starts_with', 'value' => 'A']]])->assertOk()->assertJsonCount(2, 'rows');
        $rows('users', ['filters' => [['column' => 'name', 'op' => 'contains', 'value' => '%']]])->assertOk()->assertJsonCount(0, 'rows');
        $rows('users', ['filters' => [['column' => 'name', 'op' => 'contains', 'value' => '!']]])->assertOk()->assertJsonCount(0, 'rows');
        // contains / starts_with / ends_with ignore case on every engine (PostgreSQL via ILIKE).
        foreach ([['contains', 'ADA'], ['starts_with', 'ada'], ['ends_with', 'LACE']] as [$op, $value]) {
            expect($rows('users', ['filters' => [['column' => 'name', 'op' => $op, 'value' => $value]]])->assertOk()->json('rows.0.2'))->toBe('Ada Lovelace');
        }
        $rows('users', ['filters' => [['column' => 'id', 'op' => 'eq', 'value' => '']]])->assertUnprocessable();
        $rows('users', ['sort' => ['column' => 'id', 'direction' => 'desc'], 'per_page' => 1])->assertOk()
            ->assertJsonPath('rows.0.0', 3)->assertJsonPath('has_more', true);
        expect($rows('audit_log', [])->assertOk()->json('rows.0.1'))->toBe(str_repeat('x', 4000).'…');
    } finally {
        $db = $factory->make($saved);
        CommerceSchema::drop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb', 'pgsql']);

it('returns display sql that yields the same rows as the API on every engine', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        CommerceSchema::drop($db);
        CommerceSchema::create($db);
        $tricky = "O'Re".chr(92).'illy 100%';
        $db->table('users')->insert([
            ['id' => 100, 'name' => $tricky, 'email' => 'tricky@example.com'],
            ['id' => 101, 'name' => 'Plain 100x', 'email' => 'plain@example.com'],
        ]);
        $factory->release($db);
        $user = $saved->user;

        foreach ([
            ['column' => 'name', 'op' => 'eq', 'value' => $tricky],
            ['column' => 'name', 'op' => 'contains', 'value' => '100%'],
            ['column' => 'name', 'op' => 'ends_with', 'value' => chr(92).'illy 100%'],
            ['column' => 'name', 'op' => 'neq', 'value' => "'"],
        ] as $filter) {
            $res = $this->actingAs($user)->postJson(route('api.tables.rows', [$saved, 'users']), ['filters' => [$filter]])->assertOk();
            $ran = $factory->using($saved, fn ($db) => $db->select($res->json('sql')), 30);

            expect($res->json('rows'))->not->toBeEmpty()
                ->and(array_map(fn ($r) => array_values((array) $r)[0], $ran))->toEqual(array_column($res->json('rows'), 0));
        }
    } finally {
        $db = $factory->make($saved);
        CommerceSchema::drop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb', 'pgsql']);

const ROW_IDENTITY_TABLES = ['ti_part', 'ti_pk', 'ti_bare', 'ti_float', 'ti_gen'];

function rowIdentityDrop(Connection $db): void
{
    foreach (ROW_IDENTITY_TABLES as $table) {
        $db->statement('DROP TABLE IF EXISTS '.$table.($db->getDriverName() === 'pgsql' ? ' CASCADE' : ''));
    }
}

it('returns exact row identities and locked cells on every engine', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);
    $pg = $engine === 'pgsql';
    $long = str_repeat('é', 5000);

    try {
        rowIdentityDrop($db);
        // A key longer than the grid shows (PostgreSQL); MySQL/MariaDB index prefixes cap a key's length, so they
        // check exactness with a big unsigned integer and trailing spaces instead.
        $db->statement($pg
            ? 'CREATE TABLE ti_pk (code TEXT NOT NULL PRIMARY KEY, big NUMERIC(20) NOT NULL, data BYTEA, note TEXT)'
            : 'CREATE TABLE ti_pk (code VARCHAR(100) NOT NULL, big BIGINT UNSIGNED NOT NULL, data BLOB, note TEXT, PRIMARY KEY (big, code))');
        $db->table('ti_pk')->insert([
            ['code' => $pg ? $long : 'pad  ', 'big' => '18446744073709551615', 'data' => "\x00\xFF", 'note' => $long],
        ]);
        $db->statement('CREATE TABLE ti_bare (note TEXT, qty INT)');
        $db->table('ti_bare')->insert([['note' => 'short', 'qty' => 1], ['note' => $long, 'qty' => 2]]);
        $db->statement($pg ? 'CREATE TABLE ti_float (f DOUBLE PRECISION, n INT)' : 'CREATE TABLE ti_float (f DOUBLE, n INT)');
        $db->table('ti_float')->insert([['f' => 1.5, 'n' => 1]]);
        $db->statement($pg ? 'CREATE TABLE ti_gen (qty INT, total INT GENERATED ALWAYS AS (qty * 2) STORED)' : 'CREATE TABLE ti_gen (qty INT, total INT GENERATED ALWAYS AS (qty * 2) VIRTUAL)');
        $db->table('ti_gen')->insert([['qty' => 3]]);
        if ($pg) {
            $db->statement('CREATE TABLE ti_part (id INT NOT NULL, v TEXT) PARTITION BY RANGE (id)');
            $db->statement('CREATE TABLE ti_part_a PARTITION OF ti_part FOR VALUES FROM (0) TO (10)');
            $db->statement('CREATE TABLE ti_part_b PARTITION OF ti_part FOR VALUES FROM (10) TO (20)');
            $db->table('ti_part')->insert([['id' => 1, 'v' => 'a'], ['id' => 11, 'v' => 'b']]);
        }
        $factory->release($db);
        $rows = fn (string $table) => $this->actingAs($saved->user)->postJson(route('api.tables.rows', [$saved, $table]), [])->assertOk();
        // ctid identities carry the row version (xmin) and the relation file node; they vary per run, so it is checked for shape and set aside.
        $ids = fn ($res) => array_map(function (?array $id) {
            if ($id !== null && isset($id['ctid'])) {
                expect($id['xmin'])->toMatch('/^[1-9]\d*$/')->and($id['filenode'])->toMatch('/^[1-9]\d*$/');
                unset($id['xmin'], $id['filenode']);
            }

            return $id;
        }, $res->json('row_ids'));

        $res = $rows('ti_pk');
        expect($res->json('editing.method'))->toBe('primary_key')
            ->and($res->json('editing.read_only_columns'))->toBe(['data'])
            ->and($res->json('row_ids.0.key'))->toBe($pg ? ['code' => $long] : ['big' => '18446744073709551615', 'code' => 'pad  '])
            ->and($res->json('locked.0'))->toBe($pg ? [0, 2, 3] : [2, 3])
            ->and($res->json('rows.0'))->toHaveCount(4)
            ->and($res->json('sql'))->not->toContain('__dbsuperb');

        $res = $rows('ti_bare');
        if ($pg) {
            expect($res->json('editing.method'))->toBe('pg_ctid')
                // The second row's long text stays locked, but ctid + xmin still pin the row.
                ->and($ids($res))->toBe([['ctid' => '(0,1)'], ['ctid' => '(0,2)']])
                ->and($res->json('locked'))->toBe([[], [0]])
                // The client lists these in a change's `shortened` instead of sending their originals.
                ->and($res->json('shortened'))->toBe([[], [0]]);
        } else {
            expect($res->json('editing.method'))->toBe('mysql_all_values')
                ->and($res->json('row_ids'))->toBe([['values' => ['note' => 'short', 'qty' => 1]], null])
                ->and($res->json('locked'))->toBe([[], [0]]);
        }

        // Floats can't be compared exactly: no all-values row can be pinned. The ctid method doesn't need them.
        $res = $rows('ti_float');
        expect($ids($res)[0])->toBe($pg ? ['ctid' => '(0,1)'] : null)
            ->and($res->json('locked.0'))->toBe($pg ? [] : [0]);

        // Generated columns are read-only, but their value still identifies an all-values row.
        $res = $rows('ti_gen');
        expect($res->json('editing.read_only_columns'))->toBe(['total'])
            ->and($res->json('locked.0'))->toBe([1])
            ->and($ids($res)[0])->toBe($pg ? ['ctid' => '(0,1)'] : ['values' => ['qty' => 3, 'total' => 6]]);

        if ($pg) {
            $res = $rows('ti_part');
            $oids = $factory->using($saved, fn ($db) => array_map(fn ($r) => (string) $r->oid, $db->select("select 'ti_part_a'::regclass::oid as oid union all select 'ti_part_b'::regclass::oid")), 30);
            expect($res->json('editing.method'))->toBe('pg_ctid')
                ->and($ids($res))->toBe([['ctid' => '(0,1)', 'tableoid' => $oids[0]], ['ctid' => '(0,1)', 'tableoid' => $oids[1]]]);
        }
    } finally {
        $db = $factory->make($saved);
        rowIdentityDrop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb', 'pgsql']);

it('marks views as not editable on every engine', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);

    try {
        CommerceSchema::drop($db);
        CommerceSchema::create($db);
        $factory->release($db);

        $res = $this->actingAs($saved->user)->postJson(route('api.tables.rows', [$saved, 'order_totals']), [])->assertOk();
        expect($res->json('editing'))->toBe(['method' => 'none', 'reason' => "views can't be edited", 'read_only_columns' => []])
            ->and(array_unique($res->json('row_ids')))->toBe([null]);
    } finally {
        $db = $factory->make($saved);
        CommerceSchema::drop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb', 'pgsql']);

it('filters date and date-time columns by on, between and after on every engine', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);
    $drop = fn (Connection $db) => $db->statement('DROP TABLE IF EXISTS df_events');

    try {
        $drop($db);
        $db->statement('CREATE TABLE df_events (id INT NOT NULL PRIMARY KEY, d DATE, ts '.($engine === 'pgsql' ? 'TIMESTAMP' : 'DATETIME').')');
        $db->table('df_events')->insert([
            ['id' => 1, 'd' => '2026-09-30', 'ts' => '2026-10-01 00:00:00'],
            ['id' => 2, 'd' => '2026-10-01', 'ts' => '2026-10-15 23:59:59'],
            ['id' => 3, 'd' => '2026-10-31', 'ts' => '2026-10-16 00:00:00'],
            ['id' => 4, 'd' => '2026-11-01', 'ts' => '2026-10-31 12:00:00'],
        ]);
        $factory->release($db);

        foreach ([
            [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-01', 'to' => '2026-10-15'], [1, 2], ">= '2026-10-01'"],
            [['column' => 'ts', 'op' => 'on', 'value' => '2026-10-15'], [2], "< '2026-10-16'"],
            [['column' => 'ts', 'op' => 'after', 'value' => '2026-10-15'], [3, 4], ">= '2026-10-16'"],
            [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-01', 'to' => '2026-10-15 23:59:58'], [1], "<= '2026-10-15 23:59:58'"],
            [['column' => 'd', 'op' => 'between', 'value' => '2026-10-01', 'to' => '2026-10-31'], [2, 3], "BETWEEN '2026-10-01' AND '2026-10-31'"],
            [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-01 00:00:00', 'to' => '2026-10-15 23:59:59'], [1, 2], "BETWEEN '2026-10-01 00:00:00' AND '2026-10-15 23:59:59'"],
        ] as [$filter, $ids, $sql]) {
            $res = $this->actingAs($saved->user)->postJson(route('api.tables.rows', [$saved, 'df_events']), ['filters' => [$filter]])->assertOk();
            $ran = $factory->using($saved, fn ($db) => $db->select($res->json('sql')), 30);

            expect(array_column($res->json('rows'), 0))->toBe($ids)
                ->and($res->json('sql'))->toContain($sql)
                ->and(array_map(fn ($r) => (int) array_values((array) $r)[0], $ran))->toBe($ids);
            $this->actingAs($saved->user)->postJson(route('api.tables.count', [$saved, 'df_events']), ['filters' => [$filter]])
                ->assertOk()->assertJsonPath('count', count($ids));
        }
    } finally {
        $db = $factory->make($saved);
        $drop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb', 'pgsql']);

it('filters time-zone-aware timestamp columns by on and date-only between, as stored in the session time zone', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $saved->user()->associate(User::factory()->create())->save();
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);
    $drop = fn (Connection $db) => $db->statement('DROP TABLE IF EXISTS df_zoned');

    try {
        $drop($db);
        // PostgreSQL timestamptz, MySQL/MariaDB TIMESTAMP: both store an instant and read it back in the session time zone.
        $db->statement('CREATE TABLE df_zoned (id INT NOT NULL PRIMARY KEY, ts '.($engine === 'pgsql' ? 'TIMESTAMPTZ' : 'TIMESTAMP NULL DEFAULT NULL').')');
        $db->table('df_zoned')->insert([
            ['id' => 1, 'ts' => '2026-10-01 00:00:00'],
            ['id' => 2, 'ts' => '2026-10-15 23:59:59'],
            ['id' => 3, 'ts' => '2026-10-16 00:00:00'],
            ['id' => 4, 'ts' => '2026-09-30 23:59:59'],
        ]);
        $factory->release($db);

        foreach ([
            [['column' => 'ts', 'op' => 'on', 'value' => '2026-10-15'], [2]],
            [['column' => 'ts', 'op' => 'on', 'value' => '2026-10-16'], [3]],
            [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-01', 'to' => '2026-10-15'], [1, 2]],
            [['column' => 'ts', 'op' => 'between', 'value' => '2026-10-15', 'to' => '2026-10-16'], [2, 3]],
            [['column' => 'ts', 'op' => 'after', 'value' => '2026-10-15'], [3]],
        ] as [$filter, $ids]) {
            $res = $this->actingAs($saved->user)->postJson(route('api.tables.rows', [$saved, 'df_zoned']), ['filters' => [$filter]])->assertOk();
            $ran = $factory->using($saved, fn ($db) => $db->select($res->json('sql')), 30);

            expect(array_column($res->json('rows'), 0))->toBe($ids, json_encode($filter))
                ->and(array_map(fn ($r) => (int) array_values((array) $r)[0], $ran))->toBe($ids);
            $this->actingAs($saved->user)->postJson(route('api.tables.count', [$saved, 'df_zoned']), ['filters' => [$filter]])
                ->assertOk()->assertJsonPath('count', count($ids));
        }
        // The stored value reads back unchanged in the session time zone: no conversion between insert and filter.
        $res = $this->actingAs($saved->user)->postJson(route('api.tables.rows', [$saved, 'df_zoned']), ['filters' => [['column' => 'ts', 'op' => 'on', 'value' => '2026-10-15']]])->assertOk();
        expect((string) $res->json('rows.0.1'))->toStartWith('2026-10-15 23:59:59');
    } finally {
        $db = $factory->make($saved);
        $drop($db);
        $factory->release($db);
    }
})->with(['mysql', 'mariadb', 'pgsql']);
