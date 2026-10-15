import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryColumn } from '@/types/schema';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useWorkspace } from '@/universe/store';
import {
    explorableTable,
    foreignRecordTarget,
    keyDisplay,
    openRecord,
    parsePaletteRecord,
    rowRecordTarget,
} from './open-record';
import { useRecords } from './records-store';

const col = (name: string, type = 'integer') => ({
    name,
    type,
    type_name: type,
    nullable: false,
    default: null,
    auto_increment: false,
    comment: null,
});

const snapshot = makeSnapshot(
    [
        { name: 'users', columns: [col('id'), col('email', 'text')] },
        {
            name: 'orders',
            columns: [col('id'), col('user_id'), col('code', 'text')],
        },
        {
            name: 'product_tags',
            primary_key: ['product_id', 'tag'],
            columns: [col('product_id'), col('tag', 'text')],
        },
        { name: 'audit_log', primary_key: [] },
        {
            name: 'blobs',
            primary_key: ['id'],
            columns: [col('id', 'blob')],
        },
        { name: 'v_users', kind: 'view' },
        { name: 'big', columns: [col('id', 'bigint')] },
    ],
    [
        { from_table: 'orders', to_table: 'users', from_columns: ['user_id'] },
        {
            from_table: 'orders',
            to_table: 'users',
            from_columns: ['code'],
            to_columns: ['email'],
        },
        {
            from_table: 'orders',
            to_table: 'product_tags',
            from_columns: ['id'],
            to_columns: ['product_id'],
        },
        {
            from_table: 'orders',
            to_table: 'product_tags',
            from_columns: ['user_id', 'code'],
            to_columns: ['product_id', 'tag'],
        },
    ],
);

const orderCols: QueryColumn[] = [
    { name: 'id', type: 'int', table: 'orders' },
    { name: 'user_id', type: 'int', table: 'orders' },
];

describe('explorableTable', () => {
    it('requires a table with a usable primary key', () => {
        expect(explorableTable(snapshot, 'users')?.name).toBe('users');
        expect(explorableTable(snapshot, 'audit_log')).toBeNull();
        expect(explorableTable(snapshot, 'v_users')).toBeNull();
        expect(explorableTable(snapshot, 'blobs')).toBeNull();
        expect(explorableTable(snapshot, 'nope')).toBeNull();
    });
});

describe('foreignRecordTarget', () => {
    it('opens the parent record when the FK targets its whole PK', () => {
        expect(foreignRecordTarget(snapshot, orderCols[1], 2)).toEqual({
            table: 'users',
            key: { id: 2 },
        });
    });

    it('returns null for a non-PK target, a partial composite PK and null values', () => {
        expect(
            foreignRecordTarget(
                snapshot,
                { name: 'code', type: 'text', table: 'orders' },
                'a@b.c',
            ),
        ).toBeNull();
        expect(
            foreignRecordTarget(
                snapshot,
                { name: 'id', type: 'int', table: 'orders' },
                1,
            ),
        ).toBeNull();
        expect(foreignRecordTarget(snapshot, orderCols[1], null)).toBeNull();
    });

    it('keeps unsafe integers as strings', () => {
        expect(
            foreignRecordTarget(snapshot, orderCols[1], '9007199254740993'),
        ).toEqual({ table: 'users', key: { id: '9007199254740993' } });
        expect(foreignRecordTarget(snapshot, orderCols[1], '7')).toEqual({
            table: 'users',
            key: { id: 7 },
        });
    });
});

describe('rowRecordTarget', () => {
    it('builds the key of a single-table result row', () => {
        expect(rowRecordTarget(snapshot, orderCols, [5, 2])).toEqual({
            table: 'orders',
            key: { id: 5 },
        });
    });

    it('returns null for mixed tables, a missing PK column, a binary PK and unknown tables', () => {
        expect(
            rowRecordTarget(
                snapshot,
                [orderCols[0], { name: 'email', type: 'text', table: 'users' }],
                [1, 'x'],
            ),
        ).toBeNull();
        expect(rowRecordTarget(snapshot, [orderCols[1]], [2])).toBeNull();
        expect(
            rowRecordTarget(
                snapshot,
                [{ name: 'id', type: 'blob', table: 'blobs' }],
                ['[binary 4 bytes]'],
            ),
        ).toBeNull();
        expect(
            rowRecordTarget(
                snapshot,
                [{ name: 'id', type: 'int4', table: null }],
                [1],
            ),
        ).toBeNull();
        expect(rowRecordTarget(snapshot, orderCols, [null, 2])).toBeNull();
    });

    it('needs every PK column exactly once and uses the snapshot type', () => {
        const cols: QueryColumn[] = [
            { name: 'tag', type: null, table: 'product_tags' },
            { name: 'product_id', type: null, table: 'product_tags' },
        ];
        expect(rowRecordTarget(snapshot, cols, ['rgb', 1])).toEqual({
            table: 'product_tags',
            key: { product_id: 1, tag: 'rgb' },
        });
        expect(
            rowRecordTarget(snapshot, [...cols, cols[0]], ['rgb', 1, 'x']),
        ).toBeNull();
    });
});

describe('parsePaletteRecord', () => {
    it('parses a single-column key', () => {
        expect(parsePaletteRecord(snapshot, 'users 42')).toEqual({
            table: 'users',
            key: { id: 42 },
        });
    });

    it('matches the table case-insensitively as a fallback', () => {
        expect(parsePaletteRecord(snapshot, 'Users 42')?.table).toBe('users');
    });

    it('parses composite keys in PK order and checks the arity', () => {
        expect(parsePaletteRecord(snapshot, 'product_tags 1, rgb')).toEqual({
            table: 'product_tags',
            key: { product_id: 1, tag: 'rgb' },
        });
        expect(parsePaletteRecord(snapshot, 'product_tags 1')).toBeNull();
    });

    it('returns null for tables without a PK, views and non-integer ids', () => {
        expect(parsePaletteRecord(snapshot, 'audit_log 1')).toBeNull();
        expect(parsePaletteRecord(snapshot, 'v_users 1')).toBeNull();
        expect(parsePaletteRecord(snapshot, 'users abc')).toBeNull();
        expect(parsePaletteRecord(snapshot, 'users')).toBeNull();
    });

    it('keeps integers beyond 2^53 as strings', () => {
        expect(
            parsePaletteRecord(snapshot, 'big 9007199254740993')?.key,
        ).toEqual({ id: '9007199254740993' });
        expect(
            parsePaletteRecord(snapshot, 'big 9007199254740991')?.key,
        ).toEqual({ id: 9007199254740991 });
    });
});

describe('openRecord', () => {
    beforeEach(() => useWorkspace.getState().reset());

    it('opens the record in the store and switches to the records view', () => {
        const open = vi.fn();
        useRecords.setState({ open });
        openRecord({ table: 'users', key: { id: 2 } });
        expect(open).toHaveBeenCalledWith('users', { id: 2 });
        expect(useWorkspace.getState().view).toBe('records');
    });

    it('displays a key', () => {
        expect(keyDisplay({ a: 1, b: 'x' })).toBe('1, x');
    });
});
