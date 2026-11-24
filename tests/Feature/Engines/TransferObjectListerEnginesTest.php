<?php

use App\Database\ConnectionFactory;
use App\Enums\DriverName;
use App\Transfers\Export\DumpObject;
use App\Transfers\Export\ExportOptions;
use App\Transfers\Export\ObjectLister;
use Illuminate\Database\Connection;
use Tests\Support\Engines;

it('lists tables and views, with schemas on PostgreSQL', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $saved = Engines::savedConnection($engine);
    $pg = $saved->driver === DriverName::Postgres;

    $objects = app(ConnectionFactory::class)->using($saved, function (Connection $db) use ($saved, $pg) {
        $cleanup = function () use ($db, $pg) {
            $db->statement('DROP VIEW IF EXISTS v_list');
            $db->statement('DROP TABLE IF EXISTS t_list');
            if ($pg) {
                $db->statement('DROP TABLE IF EXISTS t_part CASCADE');
                $db->statement('DROP SCHEMA IF EXISTS sales CASCADE');
            }
        };
        $cleanup();
        $db->statement('CREATE TABLE t_list (id INTEGER)');
        $db->statement('CREATE VIEW v_list AS SELECT id FROM t_list');
        if ($pg) {
            $db->statement('CREATE SCHEMA sales');
            $db->statement('CREATE TABLE sales.orders (id INTEGER)');
            $db->statement('CREATE TABLE t_part (id INTEGER) PARTITION BY RANGE (id)');
            $db->statement('CREATE TABLE t_part_1 PARTITION OF t_part FOR VALUES FROM (0) TO (10)');
            $db->statement('CREATE TABLE t_part_2 PARTITION OF t_part FOR VALUES FROM (10) TO (20)');
        }
        try {
            return ObjectLister::list($db, $saved->driver);
        } finally {
            $cleanup();
        }
    });

    $find = fn (string $name, ?string $schema) => collect($objects)->first(
        fn (DumpObject $o) => $o->name === $name && $o->schema === $schema,
    );

    expect($find('t_list', $pg ? 'public' : null)?->kind)->toBe('table')
        ->and($find('v_list', $pg ? 'public' : null)?->kind)->toBe('view');
    if ($pg) {
        expect($find('t_part', 'public')?->kind)->toBe('table')
            ->and($find('t_part_1', 'public'))->toBeNull()
            ->and($find('t_part_2', 'public'))->toBeNull()
            ->and($find('orders', 'sales')?->kind)->toBe('table')
            ->and(collect($objects)->contains(fn (DumpObject $o) => in_array($o->schema, ['pg_catalog', 'information_schema'], true)))->toBeFalse()
            ->and($find('orders', 'sales')->key())->toBe('["sales","orders"]');
    } else {
        expect($find('t_list', null)->key())->toBe('t_list')
            ->and(collect($objects)->contains(fn (DumpObject $o) => str_starts_with($o->name, 'sqlite_')))->toBeFalse();
    }
})->with(Engines::ENGINES);

it('builds export options from a validated request', function () {
    $o = ExportOptions::fromRequest(['tables' => ['a'], 'structure' => true, 'data' => false, 'drop' => true, 'gzip' => true, 'table_modes' => []]);
    expect($o->tables)->toBe(['a'])->and($o->data)->toBeFalse()->and($o->dropFirst)->toBeTrue()
        ->and($o->toArray())->toBe(['tables' => ['a'], 'structure' => true, 'data' => false, 'drop' => true, 'gzip' => true, 'table_modes' => []]);

    $d = ExportOptions::fromRequest([]);
    expect($d->tables)->toBeNull()->and($d->structure)->toBeTrue()->and($d->data)->toBeTrue()
        ->and($d->dropFirst)->toBeFalse()->and($d->gzip)->toBeFalse();
});

it('rejects bad export options and object kinds', function () {
    expect(ExportOptions::fromRequest(['tables' => 'all'])->tables)->toBeNull()
        ->and(fn () => ExportOptions::fromRequest(['tables' => 'x']))->toThrow(InvalidArgumentException::class)
        ->and(fn () => ExportOptions::fromRequest(['tables' => [1]]))->toThrow(InvalidArgumentException::class)
        ->and(fn () => new DumpObject(null, 'a', 'sequence'))->toThrow(InvalidArgumentException::class);
});
