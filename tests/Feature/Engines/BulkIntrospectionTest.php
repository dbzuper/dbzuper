<?php

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Schema\ColumnInfo;
use App\Database\Schema\Relationship;
use App\Database\Schema\SnapshotService;
use App\Models\SavedConnection;
use App\Models\User;
use App\Support\Demo\CommerceSchema;
use Illuminate\Database\Connection;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Event;
use Tests\Support\Engines;

const BULK_EXTRA_TABLES = 40;

function bulkFixture(Connection $db): void
{
    CommerceSchema::drop($db);
    $schema = $db->getSchemaBuilder();
    for ($i = BULK_EXTRA_TABLES - 1; $i >= 0; $i--) {
        $schema->dropIfExists(sprintf('bulk_t%02d', $i));
    }
    CommerceSchema::create($db);
    for ($i = 0; $i < BULK_EXTRA_TABLES; $i++) {
        $schema->create(sprintf('bulk_t%02d', $i), function (Blueprint $t) use ($i) {
            $t->id();
            $t->string('label')->nullable();
            if ($i > 0) {
                $t->foreignId(sprintf('bulk_t%02d_id', $i - 1))->nullable()->constrained(sprintf('bulk_t%02d', $i - 1));
            }
        });
    }
}

function bulkTeardown(Connection $db): void
{
    $schema = $db->getSchemaBuilder();
    for ($i = BULK_EXTRA_TABLES - 1; $i >= 0; $i--) {
        $schema->dropIfExists(sprintf('bulk_t%02d', $i));
    }
    CommerceSchema::drop($db);
}

it('describes every table exactly like the per-table Laravel builder', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);

    app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($saved) {
        bulkFixture($db);
        try {
            $snapshot = app(DriverRegistry::class)->for($saved->driver)->inspector()->inspect($db, $saved);
            $builder = $db->getSchemaBuilder();
            $schema = $snapshot->schema;

            foreach ($snapshot->tables as $table) {
                $qualified = $schema.'.'.$table->name;
                $expectedColumns = array_map(fn ($c) => ColumnInfo::fromLaravel($c)->toArray(), $builder->getColumns($qualified));
                expect(array_map(fn ($c) => $c->toArray(), $table->columns))->toBe($expectedColumns, "columns of {$table->name}");

                if ($table->kind === 'table') {
                    $expectedIndexes = collect($builder->getIndexes($qualified))
                        ->map(fn ($i) => [(string) $i['name'], array_values($i['columns']), (bool) $i['unique'], (bool) $i['primary']])
                        ->sortBy(0)->values()->all();
                    $actualIndexes = array_map(fn ($i) => [$i->name, $i->columns, $i->unique, $i->primary], $table->indexes);
                    expect($actualIndexes)->toBe($expectedIndexes, "indexes of {$table->name}");
                }
            }

            $expectedDeclared = collect($snapshot->tables)->where('kind', 'table')
                ->flatMap(fn ($t) => collect($builder->getForeignKeys($schema.'.'.$t->name))
                    ->map(fn ($fk) => Relationship::declared($t->name, $fk['columns'], $fk['foreign_table'], $fk['foreign_columns'], $fk['name'] ?: null)->id))
                ->sort()->values()->all();
            $actualDeclared = collect($snapshot->relationships)->where('inferred', false)->pluck('id')->sort()->values()->all();
            expect($actualDeclared)->toBe($expectedDeclared);
        } finally {
            bulkTeardown($db);
        }
    });
})->with(['mysql', 'mariadb', 'pgsql']);

it('uses a constant number of queries regardless of table count', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);

    app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($saved) {
        bulkFixture($db);
        try {
            $count = 0;
            Event::listen(QueryExecuted::class, function (QueryExecuted $e) use ($db, &$count) {
                if ($e->connectionName === $db->getName()) {
                    $count++;
                }
            });

            $snapshot = app(DriverRegistry::class)->for($saved->driver)->inspector()->inspect($db, $saved);

            expect(count($snapshot->tables))->toBeGreaterThan(BULK_EXTRA_TABLES)
                ->and($count)->toBeLessThanOrEqual(8);
        } finally {
            bulkTeardown($db);
        }
    });
})->with(['mysql', 'mariadb', 'pgsql']);

it('applies the introspection timeout when refreshing a snapshot', function () {
    config(['dbzuper.introspection_timeout' => 9]);
    Engines::skipUnlessAvailable('mysql');
    $user = User::factory()->create();
    $p = Engines::params('mysql');
    $connection = SavedConnection::factory()->for($user)->create([
        'host' => $p['host'], 'port' => $p['port'], 'database' => $p['database'], 'username' => $p['username'], 'password' => $p['password'],
    ]);

    $seen = [];
    Event::listen(QueryExecuted::class, function (QueryExecuted $e) use (&$seen) {
        $seen[] = $e->sql;
    });

    app(SnapshotService::class)->refresh($connection);

    expect(collect($seen)->contains(fn ($sql) => str_contains(strtolower($sql), 'max_execution_time = 9000')))->toBeTrue();
});
