<?php

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Drivers\MySqlDriver;
use App\Database\Errors\DbErrorMapper;
use App\Database\Exceptions\OffsetQueryException;
use App\Database\Sql\StatementClassifier;
use Illuminate\Database\Connection;
use Illuminate\Database\Schema\Blueprint;
use Tests\Support\Engines;

afterEach(fn () => Engines::resetSqlite());

function withBigTable(string $engine, Closure $fn): mixed
{
    $saved = Engines::savedConnection($engine);

    return app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($fn, $saved) {
        $schema = $db->getSchemaBuilder();
        $schema->dropIfExists('exec_big');
        $schema->create('exec_big', function (Blueprint $t) {
            $t->integer('id');
            $t->text('body')->nullable();
        });
        $rows = [];
        for ($i = 1; $i <= 20000; $i++) {
            $rows[] = ['id' => $i, 'body' => $i === 1 ? str_repeat('x', 10000) : 'row '.$i];
            if (count($rows) === 1000) {
                $db->table('exec_big')->insert($rows);
                $rows = [];
            }
        }
        try {
            return $fn($db, app(DriverRegistry::class)->for($saved->driver), $saved->driver->value);
        } finally {
            $schema->dropIfExists('exec_big');
        }
    });
}

it('caps rows, marks truncation and bounds cell size', function (string $engine) {
    Engines::skipUnlessAvailable($engine);

    $result = withBigTable($engine, fn ($db, $driver, $dialect) => $driver->execute(
        $db, 'select id, body from exec_big order by id', StatementClassifier::classify('select 1', $dialect), 1000, 20_000_000,
    ));

    expect($result->rows)->toHaveCount(1000)
        ->and($result->truncated)->toBeTrue()
        ->and(array_column($result->columns, 'name'))->toBe(['id', 'body'])
        ->and(mb_strlen($result->rows[0][1]))->toBe(4001) // 4000 chars + ellipsis
        ->and($result->error)->toBeNull();
})->with(Engines::ENGINES);

it('stops at the byte cap', function (string $engine) {
    Engines::skipUnlessAvailable($engine);

    $result = withBigTable($engine, fn ($db, $driver, $dialect) => $driver->execute(
        $db, 'select id, body from exec_big order by id', StatementClassifier::classify('select 1', $dialect), 10000, 50_000,
    ));

    expect(count($result->rows))->toBeLessThan(10000)->and($result->truncated)->toBeTrue();
})->with(Engines::ENGINES);

it('can run another statement on the same connection after a truncated read', function (string $engine) {
    Engines::skipUnlessAvailable($engine);

    $count = withBigTable($engine, function ($db, $driver, $dialect) {
        $driver->execute($db, 'select id from exec_big', StatementClassifier::classify('select 1', $dialect), 10, 20_000_000);

        return $driver->execute($db, 'select count(*) as c from exec_big', StatementClassifier::classify('select 1', $dialect), 10, 20_000_000)->rows[0][0];
    });

    expect((int) $count)->toBe(20000);
})->with(Engines::ENGINES);

it('reports affected rows for writes', function (string $engine) {
    Engines::skipUnlessAvailable($engine);

    $result = withBigTable($engine, fn ($db, $driver, $dialect) => $driver->execute(
        $db, 'update exec_big set body = null where id <= 5', StatementClassifier::classify('update x set a=1 where b', $dialect), 1000, 20_000_000,
    ));

    expect($result->affected)->toBe(5)->and($result->columns)->toBe([]);
})->with(Engines::ENGINES);

it('refuses a second smuggled statement', function (string $engine, string $sql) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);

    $outcome = app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($saved, $sql) {
        $db->getSchemaBuilder()->dropIfExists('smuggle_probe');
        $db->getSchemaBuilder()->create('smuggle_probe', fn (Blueprint $t) => $t->integer('id'));
        try {
            app(DriverRegistry::class)->for($saved->driver)->execute($db, $sql, StatementClassifier::classify('select 1', 'mysql'), 10, 1_000_000);
        } catch (Throwable) {
        }
        $exists = $db->getSchemaBuilder()->hasTable('smuggle_probe');
        $db->getSchemaBuilder()->dropIfExists('smuggle_probe');

        return $exists;
    });

    expect($outcome)->toBeTrue();
})->with([
    'mysql --x' => ['mysql', 'select 1 --x;drop table smuggle_probe'],
    'mariadb plain' => ['mariadb', 'select 1; drop table smuggle_probe'],
    'pgsql plain' => ['pgsql', 'select 1; drop table smuggle_probe'],
]);

it('maps a PostgreSQL syntax error inside the cursor to a position in the user SQL and stays usable', function () {
    Engines::skipUnlessAvailable('pgsql');
    $saved = Engines::savedConnection('pgsql');

    $outcome = app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($saved) {
        $driver = app(DriverRegistry::class)->for($saved->driver);
        $classification = StatementClassifier::classify('select 1', 'pgsql');
        try {
            $driver->execute($db, "select 1\nselect * form users", $classification, 10, 1_000_000);
            $error = null;
        } catch (Throwable $e) {
            $error = (new DbErrorMapper)->map($e);
        }
        $next = $driver->execute($db, 'select 1 as one', $classification, 10, 1_000_000);

        return [$error, $db->getPdo()->inTransaction(), $next->rows];
    });

    expect($outcome[0]->kind)->toBe('syntax')
        ->and($outcome[0]->position['line'])->toBe(2)
        ->and($outcome[1])->toBeFalse()
        ->and($outcome[2])->toBe([[1]]);
});

it('uses the bounded cursor for comment-prefixed reads', function () {
    Engines::skipUnlessAvailable('pgsql');

    $result = withBigTable('pgsql', fn ($db, $driver, $dialect) => $driver->execute(
        $db, "-- note\n/* more */ select id from exec_big order by id", StatementClassifier::classify("-- note\nselect 1", 'pgsql'), 10, 20_000_000,
    ));
    expect($result->rows)->toHaveCount(10)->and($result->truncated)->toBeTrue();

    // Only the cursor path wraps errors with the DECLARE offset.
    $saved = Engines::savedConnection('pgsql');
    $thrown = app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($saved) {
        try {
            app(DriverRegistry::class)->for($saved->driver)->execute($db, "-- note\nselect * form users", StatementClassifier::classify("-- note\nselect 1", 'pgsql'), 10, 1_000_000);
        } catch (Throwable $e) {
            return $e;
        }
    });
    expect($thrown)->toBeInstanceOf(OffsetQueryException::class);
});

it('pages the cursor fetch and keeps exact truncation semantics', function (int $maxRows, bool $truncated) {
    Engines::skipUnlessAvailable('pgsql');

    $result = withBigTable('pgsql', fn ($db, $driver, $dialect) => $driver->execute(
        $db, 'select id from exec_big where id <= 450 order by id', StatementClassifier::classify('select 1', 'pgsql'), $maxRows, 20_000_000,
    ));

    expect($result->rows)->toHaveCount(min($maxRows, 450))->and($result->truncated)->toBe($truncated);
})->with([[449, true], [450, false], [451, false], [200, true], [400, true]]);

it('keeps jsonb question-mark operators and literal question marks on PostgreSQL', function (string $sql, mixed $expected) {
    Engines::skipUnlessAvailable('pgsql');
    $saved = Engines::savedConnection('pgsql');

    $value = app(ConnectionFactory::class)->using($saved, fn (Connection $db) => app(DriverRegistry::class)->for($saved->driver)
        ->execute($db, $sql, StatementClassifier::classify($sql, 'pgsql'), 10, 1_000_000));

    expect($value->rows[0][0])->toBe($expected)->and($value->sql)->toBe($sql);

    // The same text through the non-cursor path (a write classification) must escape identically.
    $plain = app(ConnectionFactory::class)->using($saved, fn (Connection $db) => app(DriverRegistry::class)->for($saved->driver)
        ->execute($db, $sql, StatementClassifier::classify('update x set a=1 where b', 'pgsql'), 10, 1_000_000));
    expect($plain->rows[0][0])->toBe($expected)->and($plain->sql)->toBe($sql);
})->with([
    'jsonb ?' => ['select \'{"a":1}\'::jsonb ? \'a\' as has_a', true],
    'jsonb ?|' => ['select \'{"a":1}\'::jsonb ?| array[\'a\',\'b\'] as x', true],
    'array slice' => ['select (array[1,2,3])[lo:hi] from (select 1 as lo, 2 as hi) s', '{1,2}'],
    'cast stays' => ['select \'{"a":1}\'::jsonb as j', '{"a": 1}'],
    'string literal' => ['select \'?\' as q', '?'],
    'comment and quoted identifier' => ["select 1 as \"a?b\" -- why?\n", 1],
]);

it('strips composite sql modes that re-enable ANSI_QUOTES', function (string $engine, string $mode) {
    Engines::skipUnlessAvailable($engine);

    $out = app(ConnectionFactory::class)->using(Engines::savedConnection($engine), function (Connection $db) use ($mode) {
        $db->statement("SET SESSION sql_mode = '{$mode}'");
        $db->statement('SET SESSION sql_mode = '.MySqlDriver::STRIPPED_SQL_MODE);

        return [(string) $db->selectOne('select @@session.sql_mode as m')->m, (string) $db->selectOne('select "x" as v')->v];
    });

    expect($out[1])->toBe('x')->and($out[0])->not->toContain('ANSI')->not->toContain('NO_BACKSLASH_ESCAPES');
})->with(array_merge(
    // MySQL 8.4 only still accepts ANSI; MariaDB keeps the other composite modes.
    array_map(fn ($m) => ['mysql', $m], ['ANSI', 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES,STRICT_TRANS_TABLES']),
    array_map(fn ($m) => ['mariadb', $m], ['ANSI', 'ORACLE', 'MSSQL', 'POSTGRESQL', 'DB2', 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES,STRICT_TRANS_TABLES']),
));

it('caps reads server-side on MySQL and MariaDB and resets the cap afterwards, also after an error', function (string $engine) {
    Engines::skipUnlessAvailable($engine);

    [$capped, $limitDuring, $limitAfter, $limitAfterError, $all] = withBigTable($engine, function ($db, $driver, $dialect) {
        $read = StatementClassifier::classify('select 1', $dialect);
        $capped = $driver->execute($db, 'select id from exec_big order by id', $read, 10, 20_000_000);
        $limitDuring = $driver->execute($db, 'select @@session.sql_select_limit', $read, 10, 20_000_000)->rows[0][0];
        $limitAfter = $db->selectOne('select @@session.sql_select_limit as l')->l;
        try {
            $driver->execute($db, 'select * from no_such_table', $read, 10, 20_000_000);
        } catch (Throwable) {
        }
        $limitAfterError = $db->selectOne('select @@session.sql_select_limit as l')->l;

        return [$capped, $limitDuring, $limitAfter, $limitAfterError, count($db->select('select id from exec_big'))];
    });

    expect($capped->truncated)->toBeTrue()
        ->and(array_column($capped->rows, 0))->toBe(range(1, 10))
        ->and((string) $limitDuring)->toBe('11')
        ->and((string) $limitAfter)->toBe('18446744073709551615')
        ->and((string) $limitAfterError)->toBe('18446744073709551615')
        ->and($all)->toBe(20000);
})->with(['mysql', 'mariadb']);
