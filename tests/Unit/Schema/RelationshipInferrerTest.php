<?php

use App\Database\Schema\ColumnInfo;
use App\Database\Schema\Relationship;
use App\Database\Schema\RelationshipInferrer;
use App\Database\Schema\RowCount;
use App\Database\Schema\TableInfo;

function col(string $name, string $typeName = 'bigint'): ColumnInfo
{
    return new ColumnInfo($name, $typeName, $typeName, true, null, false, null);
}

function tbl(string $name, array $columns, array $pk = ['id'], string $kind = 'table'): TableInfo
{
    return new TableInfo($name, $kind, RowCount::unknown(), null, $columns, $pk, []);
}

function inferred(array $tables, array $declared = []): array
{
    return collect((new RelationshipInferrer)->infer($tables, $declared))
        ->mapWithKeys(fn (Relationship $r) => ["{$r->fromTable}.{$r->fromColumns[0]}" => $r])
        ->all();
}

it('links plural, singular and reserved-word table names', function () {
    $result = inferred([
        tbl('users', [col('id'), col('group_id')]),
        tbl('group', [col('id')]),
        tbl('orders', [col('id'), col('user_id')]),
    ]);

    expect($result['orders.user_id']->toTable)->toBe('users')
        ->and($result['orders.user_id']->toColumns)->toBe(['id'])
        ->and($result['orders.user_id']->inferred)->toBeTrue()
        ->and($result['orders.user_id']->id)->toBe('inferred:orders(user_id)->users(id)')
        ->and($result['users.group_id']->toTable)->toBe('group');
});

it('skips columns already covered by a declared foreign key', function () {
    $result = inferred(
        [tbl('orders', [col('id')]), tbl('order_items', [col('id'), col('order_id')])],
        [Relationship::declared('order_items', ['order_id'], 'orders', ['id'], null)],
    );

    expect($result)->toBe([]);
});

it('skips incompatible types, missing targets, views and composite/absent primary keys', function () {
    $result = inferred([
        tbl('users', [col('id')]),
        tbl('comments', [col('id'), col('user_id', 'varchar'), col('ghost_id')]),
        tbl('tags', [col('product_id'), col('tag', 'varchar')], ['product_id', 'tag']),
        tbl('notes', [col('tag_id')]),
        tbl('report_view', [col('user_id')], [], 'view'),
        tbl('logs', [col('event', 'varchar')], []),
        tbl('entries', [col('id'), col('log_id')]),
    ]);

    expect($result)->toBe([]);
});

it('treats parent_id as a self reference', function () {
    $result = inferred([tbl('categories', [col('id'), col('parent_id')])]);

    expect($result['categories.parent_id']->toTable)->toBe('categories')
        ->and($result['categories.parent_id']->confidence)->toBe(0.7);
});

it('honours a shared table prefix', function () {
    $result = inferred([tbl('app_users', [col('id')]), tbl('app_sessions', [col('id'), col('user_id')])]);

    expect($result['app_sessions.user_id']->toTable)->toBe('app_users');
});

it('matches case-insensitively and scores equal types higher', function () {
    $result = inferred([
        tbl('Users', [col('id', 'int')]),
        tbl('posts', [col('id'), col('USER_ID', 'int')]),
        tbl('likes', [col('id'), col('user_id', 'bigint')]),
    ]);

    expect($result['posts.USER_ID']->toTable)->toBe('Users')
        ->and($result['posts.USER_ID']->confidence)->toBe(0.9)
        ->and($result['likes.user_id']->confidence)->toBe(0.75);
});

it('never targets the source table and falls through to the real parent for a prefixed name', function () {
    $result = inferred([
        tbl('user_roles', [col('id'), col('user_id'), col('role_id')]),
        tbl('users', [col('id')]),
        tbl('roles', [col('id')]),
    ]);

    expect($result['user_roles.role_id']->toTable)->toBe('roles')
        ->and($result['user_roles.user_id']->toTable)->toBe('users')
        ->and(collect($result)->pluck('toTable')->all())->not->toContain('user_roles');
});

it('falls through a composite-PK candidate to the next valid parent', function () {
    $result = inferred([
        tbl('post_tags', [col('post_id'), col('tag_id')], ['post_id', 'tag_id']),
        tbl('posts', [col('id')]),
        tbl('tags', [col('id')]),
    ]);

    expect($result['post_tags.post_id']->toTable)->toBe('posts')
        ->and($result['post_tags.tag_id']->toTable)->toBe('tags');
});

it('prefers a prefixed parent but uses the unprefixed table for a non-prefixed source', function () {
    $result = inferred([
        tbl('app_users', [col('id')]),
        tbl('users', [col('id')]),
        tbl('app_sessions', [col('id'), col('user_id')]),
        tbl('audit', [col('id'), col('user_id')]),
    ]);

    expect($result['app_sessions.user_id']->toTable)->toBe('app_users')
        ->and($result['audit.user_id']->toTable)->toBe('users');
});

it('skips both columns covered by a declared composite foreign key', function () {
    $result = inferred(
        [
            tbl('orders', [col('id')], ['id']),
            tbl('shops', [col('id')]),
            tbl('order_lines', [col('id'), col('order_id'), col('shop_id')]),
        ],
        [Relationship::declared('order_lines', ['order_id', 'shop_id'], 'orders', ['id', 'shop_id'], null)],
    );

    expect($result)->toBe([]);
});
