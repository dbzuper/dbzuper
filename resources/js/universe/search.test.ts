import { describe, expect, it } from 'vitest';
import { makeSnapshot } from './__fixtures__/snapshot';
import { scoreName, searchSchema } from './search';

const snap = makeSnapshot([
    {
        name: 'orders',
        columns: [
            {
                name: 'user_id',
                type: 'int',
                type_name: 'int',
                nullable: false,
                default: null,
                auto_increment: false,
                comment: null,
            },
        ],
    },
    { name: 'order_items' },
    { name: 'users' },
    { name: 'reorders' },
]);

describe('scoreName', () => {
    it('ranks exact > prefix > substring > none, case-insensitively', () => {
        expect(scoreName('Orders', 'orders')).toBe(3);
        expect(scoreName('order_items', 'order')).toBe(2);
        expect(scoreName('reorders', 'order')).toBe(1);
        expect(scoreName('users', 'order')).toBe(0);
    });
});

describe('searchSchema', () => {
    it('ranks tables and finds columns from two characters', () => {
        const r = searchSchema(snap, 'order');
        expect(r.tables.map((h) => h.table)).toEqual([
            'order_items',
            'orders',
            'reorders',
        ]);
        expect(searchSchema(snap, 'u').columns).toEqual([]);
        expect(
            searchSchema(snap, 'user').columns.map((h) =>
                h.kind === 'column' ? `${h.table}.${h.column}` : '',
            ),
        ).toEqual(['orders.user_id']);
    });

    it('lists tables alphabetically for an empty query and respects the limit', () => {
        expect(searchSchema(snap, '', 2).tables.map((h) => h.table)).toEqual([
            'order_items',
            'orders',
        ]);
    });
});
