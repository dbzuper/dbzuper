<?php

use App\Database\Schema\ColumnInfo;
use App\Database\Schema\IndexInfo;
use App\Database\Schema\Relationship;
use App\Database\Schema\RowCount;
use App\Database\Schema\SchemaSnapshot;
use App\Database\Schema\TableInfo;
use Carbon\CarbonImmutable;

function snapshotWith(RowCount $rows, string $time = '2026-10-14 10:00:00'): SchemaSnapshot
{
    $users = new TableInfo('users', 'table', $rows, 16384,
        [new ColumnInfo('id', 'bigint unsigned', 'bigint', false, null, true, null)],
        ['id'], [new IndexInfo('primary', ['id'], true, true)]);

    return new SchemaSnapshot('mysql', 'app', 'app', CarbonImmutable::parse($time), [$users],
        [Relationship::declared('orders', ['user_id'], 'users', ['id'], 'orders_user_id_foreign')]);
}

it('serializes to the documented array shape', function () {
    $array = snapshotWith(new RowCount(3, 'estimate'))->toArray();

    expect($array)->toHaveKeys(['driver', 'database', 'schema', 'generated_at', 'hash', 'tables', 'relationships'])
        ->and($array['tables'][0])->toMatchArray([
            'name' => 'users', 'kind' => 'table', 'row_count' => ['count' => 3, 'kind' => 'estimate'],
            'size_bytes' => 16384, 'primary_key' => ['id'],
        ])
        ->and($array['tables'][0]['columns'][0])->toMatchArray(['name' => 'id', 'type_name' => 'bigint', 'auto_increment' => true])
        ->and($array['relationships'][0])->toMatchArray([
            'id' => 'fk:orders(user_id)->users(id)', 'inferred' => false, 'confidence' => 1.0,
        ]);
});

it('has a structure hash that ignores row counts and generation time', function () {
    $a = snapshotWith(new RowCount(3, 'estimate'), '2026-10-14 10:00:00');
    $b = snapshotWith(new RowCount(999, 'exact'), '2026-10-15 11:00:00');

    expect($a->structureHash())->toBe($b->structureHash())->toHaveLength(40);
});

it('finds tables and columns by name', function () {
    $snapshot = snapshotWith(RowCount::unknown());

    expect($snapshot->table('users')?->column('id')?->typeName)->toBe('bigint')
        ->and($snapshot->table('nope'))->toBeNull();
});
