import { describe, expect, it } from 'vitest';
import { makeSnapshot } from './__fixtures__/snapshot';
import { buildJoinSql, findPath } from './path';

const snap = makeSnapshot(
    [
        { name: 'orders' },
        { name: 'order_items' },
        { name: 'products' },
        { name: 'users' },
        { name: 'logs' },
        { name: 'island' },
        { name: 'odd "name"' },
    ],
    [
        {
            from_table: 'order_items',
            to_table: 'orders',
            from_columns: ['order_id'],
        },
        {
            from_table: 'order_items',
            to_table: 'products',
            from_columns: ['product_id'],
        },
        {
            from_table: 'orders',
            to_table: 'users',
            from_columns: ['user_id'],
            inferred: true,
        },
        { from_table: 'logs', to_table: 'users', from_columns: ['user_id'] },
        {
            from_table: 'odd "name"',
            to_table: 'users',
            from_columns: ['user id'],
        },
    ],
);

describe('findPath', () => {
    it('finds the shortest path through relationships in either direction', () => {
        expect(findPath(snap, 'orders', 'products', true)).toEqual([
            'orders',
            'order_items',
            'products',
        ]);
        expect(findPath(snap, 'products', 'logs', true)).toEqual([
            'products',
            'order_items',
            'orders',
            'users',
            'logs',
        ]);
    });

    it('respects the inferred toggle and reports unreachable tables', () => {
        expect(findPath(snap, 'products', 'logs', false)).toBeNull();
        expect(findPath(snap, 'orders', 'island', true)).toBeNull();
        expect(findPath(snap, 'orders', 'orders', true)).toEqual(['orders']);
    });
});

describe('buildJoinSql', () => {
    it('joins along the path with correct key directions', () => {
        expect(
            buildJoinSql(
                snap,
                ['orders', 'order_items', 'products'],
                'mysql',
                true,
            ),
        ).toBe(
            [
                'SELECT *',
                'FROM `orders` AS t0',
                'JOIN `order_items` AS t1 ON t1.`order_id` = t0.`id`',
                'JOIN `products` AS t2 ON t2.`id` = t1.`product_id`',
                'LIMIT 100;',
            ].join('\n'),
        );
    });

    it('quotes awkward identifiers per dialect', () => {
        expect(buildJoinSql(snap, ['users', 'odd "name"'], 'pgsql', true)).toBe(
            [
                'SELECT *',
                'FROM "users" AS t0',
                'JOIN "odd ""name""" AS t1 ON t1."user id" = t0."id"',
                'LIMIT 100;',
            ].join('\n'),
        );
    });

    it('prefers declared relationships and supports composite keys', () => {
        const s = makeSnapshot(
            [{ name: 'a' }, { name: 'b' }],
            [
                {
                    from_table: 'a',
                    to_table: 'b',
                    from_columns: ['x'],
                    to_columns: ['id'],
                    inferred: true,
                    confidence: 0.9,
                },
                {
                    from_table: 'a',
                    to_table: 'b',
                    from_columns: ['k1', 'k2'],
                    to_columns: ['p1', 'p2'],
                },
            ],
        );
        expect(buildJoinSql(s, ['a', 'b'], 'sqlite', true)).toContain(
            'JOIN "b" AS t1 ON t1."p1" = t0."k1" AND t1."p2" = t0."k2"',
        );
    });

    it('returns null when a hop has no usable relationship', () => {
        expect(
            buildJoinSql(snap, ['orders', 'island'], 'mysql', true),
        ).toBeNull();
        expect(
            buildJoinSql(snap, ['orders', 'users'], 'mysql', false),
        ).toBeNull();
    });
});
