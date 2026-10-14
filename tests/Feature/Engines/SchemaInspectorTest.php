<?php

use App\Database\ConnectionFactory;
use App\Database\DriverRegistry;
use App\Database\Schema\SchemaSnapshot;
use App\Support\Demo\CommerceSchema;
use Tests\Support\Engines;

function inspectEngine(string $engine): SchemaSnapshot
{
    $saved = Engines::savedConnection($engine);
    $factory = app(ConnectionFactory::class);
    $db = $factory->make($saved);
    CommerceSchema::drop($db);
    CommerceSchema::create($db);

    try {
        return app(DriverRegistry::class)->for($saved->driver)->inspector()->inspect($db, $saved);
    } finally {
        $factory->release($db);
    }
}

afterEach(fn () => Engines::resetSqlite());

it('inspects tables, views, columns and keys', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $snapshot = inspectEngine($engine);

    $names = collect($snapshot->tables)->pluck('name')->all();
    expect($names)->toContain('group', 'users', 'categories', 'products', 'orders', 'order_items', 'product_tags', 'audit_log', 'régions', 'order_totals')
        ->and($snapshot->table('order_totals')->kind)->toBe('view')
        ->and($snapshot->table('users')->kind)->toBe('table')
        ->and($snapshot->table('users')->primaryKey)->toBe(['id'])
        ->and($snapshot->table('product_tags')->primaryKey)->toBe(['product_id', 'tag'])
        ->and($snapshot->table('audit_log')->primaryKey)->toBe([])
        ->and($snapshot->table('users')->column('email')->nullable)->toBeFalse()
        ->and($snapshot->table('users')->column('profile')->nullable)->toBeTrue()
        ->and($snapshot->table('régions')->column('nom'))->not->toBeNull()
        ->and(collect($snapshot->table('users')->indexes)->firstWhere('unique', true))->not->toBeNull();
})->with(Engines::ENGINES);

it('returns declared and inferred relationships', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $relationships = collect(inspectEngine($engine)->relationships)->keyBy(fn ($r) => $r->fromTable.'.'.implode(',', $r->fromColumns));

    expect($relationships['order_items.order_id']->toTable)->toBe('orders')
        ->and($relationships['order_items.order_id']->inferred)->toBeFalse()
        ->and($relationships['categories.parent_id']->toTable)->toBe('categories')
        ->and($relationships['categories.parent_id']->inferred)->toBeFalse()
        ->and($relationships['product_tags.product_id']->toTable)->toBe('products')
        ->and($relationships['orders.user_id']->inferred)->toBeTrue()
        ->and($relationships['orders.user_id']->toTable)->toBe('users')
        ->and($relationships['users.group_id']->toTable)->toBe('group')
        ->and($relationships->where('fromTable', 'order_items')->where('inferred', true))->toBeEmpty();
})->with(Engines::ENGINES);

it('reports row counts with the right kind', function (string $engine, string $kind) {
    Engines::skipUnlessAvailable($engine);
    $users = inspectEngine($engine)->table('users');

    expect($users->rowCount->kind)->toBeIn([$kind, 'unknown']);
    if ($engine === 'sqlite') {
        expect($users->rowCount->count)->toBe(3)->and($users->rowCount->kind)->toBe('exact');
    }
})->with([['sqlite', 'exact'], ['mysql', 'estimate'], ['mariadb', 'estimate'], ['pgsql', 'estimate']]);

it('only includes the connection’s own database or schema', function (string $engine) {
    Engines::skipUnlessAvailable($engine);
    $pdo = Engines::pdo($engine);
    if ($engine === 'pgsql') {
        $pdo->exec('create schema if not exists dbsuperb_other');
        $pdo->exec('create table if not exists dbsuperb_other.foreign_thing (id int primary key)');
    } else {
        $pdo->exec('create database if not exists dbsuperb_other');
        $pdo->exec('create table if not exists dbsuperb_other.foreign_thing (id int primary key)');
    }

    $names = collect(inspectEngine($engine)->tables)->pluck('name');

    expect($names)->not->toContain('foreign_thing');
})->with(['mysql', 'mariadb', 'pgsql']);

it('emits a deterministic, sorted snapshot', function () {
    $first = inspectEngine('sqlite');
    $second = inspectEngine('sqlite');

    $names = collect($first->tables)->pluck('name')->all();
    $sorted = $names;
    sort($sorted, SORT_STRING);
    $ids = collect($first->relationships)->pluck('id')->all();
    $sortedIds = $ids;
    sort($sortedIds, SORT_STRING);

    expect($first->structureHash())->toBe($second->structureHash())
        ->and($names)->toBe($sorted)
        ->and($ids)->toBe($sortedIds);
    foreach ($first->tables as $table) {
        $indexNames = collect($table->indexes)->pluck('name')->all();
        $sortedIndexNames = $indexNames;
        sort($sortedIndexNames, SORT_STRING);
        expect($indexNames)->toBe($sortedIndexNames);
    }
});
