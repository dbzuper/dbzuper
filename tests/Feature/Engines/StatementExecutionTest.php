<?php

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Errors\DbErrorMapper;
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
