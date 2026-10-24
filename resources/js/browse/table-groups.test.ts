import { describe, expect, it } from 'vitest';
import { flattenEntries, groupKey, groupTables } from './table-groups';

const loose = (name: string) => ({
    kind: 'table',
    name,
    depth: 0,
    prefix: null,
});

describe('groupKey', () => {
    it('returns the first segment with its underscore', () => {
        expect(groupKey('courier_rates')).toBe('courier_');
        expect(groupKey('orders')).toBeNull();
        expect(groupKey('_tmp_x')).toBeNull();
    });
});

describe('groupTables', () => {
    it('groups prefixes with at least two members', () => {
        const { entries, stripped } = groupTables([
            'activity_log',
            'addresses',
            'courier_rates',
            'courier_zones',
            'orders',
            'tng_ewallet_txn',
        ]);
        expect(stripped).toBeNull();
        expect(entries).toEqual([
            loose('activity_log'),
            loose('addresses'),
            {
                kind: 'group',
                prefix: 'courier_',
                tables: ['courier_rates', 'courier_zones'],
            },
            loose('orders'),
            loose('tng_ewallet_txn'),
        ]);
    });

    it('places a group among loose tables by its prefix', () => {
        const { entries } = groupTables(['b_x', 'b_y', 'a', 'c']);
        expect(entries).toEqual([
            loose('a'),
            { kind: 'group', prefix: 'b_', tables: ['b_x', 'b_y'] },
            loose('c'),
        ]);
    });

    it('skips a common prefix and groups on the next segment', () => {
        const { entries, stripped } = groupTables([
            'wp_posts',
            'wp_postmeta',
            'wp_users',
            'wp_woo_orders',
            'wp_woo_items',
        ]);
        expect(stripped).toBe('wp_');
        expect(entries).toEqual([
            loose('wp_posts'),
            loose('wp_postmeta'),
            loose('wp_users'),
            {
                kind: 'group',
                prefix: 'wp_woo_',
                tables: ['wp_woo_orders', 'wp_woo_items'],
            },
        ]);
    });

    it('strips the common prefix one level only', () => {
        const { entries, stripped } = groupTables(['a_b_c', 'a_b_d']);
        expect(stripped).toBe('a_');
        expect(entries).toEqual([
            { kind: 'group', prefix: 'a_b_', tables: ['a_b_c', 'a_b_d'] },
        ]);
    });
});

describe('flattenEntries', () => {
    const { entries } = groupTables(['courier_rates', 'courier_zones', 'x']);

    it('hides tables of a closed group', () => {
        expect(flattenEntries(entries, new Set())).toEqual([
            { kind: 'group', prefix: 'courier_', tables: expect.any(Array) },
            loose('x'),
        ]);
    });

    it('emits the tables of an open group at depth 1', () => {
        expect(flattenEntries(entries, new Set(['courier_']))).toEqual([
            { kind: 'group', prefix: 'courier_', tables: expect.any(Array) },
            {
                kind: 'table',
                name: 'courier_rates',
                depth: 1,
                prefix: 'courier_',
            },
            {
                kind: 'table',
                name: 'courier_zones',
                depth: 1,
                prefix: 'courier_',
            },
            loose('x'),
        ]);
    });
});
