import { describe, expect, it } from 'vitest';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { completeSql, identifierFor } from './complete';

const col = (name: string) => ({
    name,
    type: 'int',
    type_name: 'int',
    nullable: true,
    default: null,
    auto_increment: false,
    comment: null,
});
const snapshot = makeSnapshot(
    [
        { name: 'orders', columns: [col('id'), col('user_id'), col('status')] },
        { name: 'users', columns: [col('id'), col('email')] },
        { name: 'group', columns: [col('id')] },
        { name: 'order_totals', kind: 'view', columns: [col('order_id')] },
    ],
    [{ from_table: 'orders', to_table: 'users', from_columns: ['user_id'] }],
    'pgsql',
);

const at = (text: string, focusedTable: string | null = null) => {
    const offset = text.indexOf('|');
    return completeSql({
        text: text.replace('|', ''),
        offset,
        snapshot,
        dialect: 'pgsql',
        focusedTable,
    });
};
const labels = (r: ReturnType<typeof at>) => r.items.map((i) => i.label);

describe('completeSql', () => {
    it('suggests tables and views after FROM, filtered by prefix', () => {
        expect(labels(at('select * from or|'))).toEqual([
            'order_totals',
            'orders',
        ]);
    });

    it('suggests columns of an aliased table after a dot', () => {
        const r = at('select o.| from orders o');
        expect(labels(r)).toEqual(['id', 'status', 'user_id']);
    });

    it('suggests FK-aware joins with the ON clause', () => {
        const r = at('select * from orders o join |');
        const join = r.items.find((i) => i.kind === 'join');
        expect(join?.insertText).toBe('users u ON u.id = o.user_id');
    });

    it('offers in-scope columns and keywords in general position', () => {
        const r = at('select st| from orders');
        expect(labels(r)).toContain('status');
        expect(labels(r)).toContain('STRING_AGG');
    });

    it('inserts the focused table for @', () => {
        const r = at('select * from @|', 'group');
        expect(r.items[0]).toMatchObject({
            kind: 'focused',
            insertText: '"group"',
        });
        expect(r.replaceFrom).toBe('select * from '.length);
    });

    it('quotes identifiers only when needed', () => {
        expect(identifierFor('orders', 'pgsql')).toBe('orders');
        expect(identifierFor('group', 'mysql')).toBe('`group`');
        expect(identifierFor('régions', 'sqlite')).toBe('"régions"');
    });
});
