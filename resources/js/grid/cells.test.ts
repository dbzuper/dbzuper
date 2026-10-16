import { describe, expect, it } from 'vitest';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import {
    binaryBytes,
    blobLabel,
    cellKind,
    cellText,
    cellTitle,
    fkTarget,
    isEmptyString,
    isLong,
} from './cells';

describe('cells', () => {
    it.each([
        [null, 'text', 'null'],
        [3, 'int', 'number'],
        ['3.5', 'numeric', 'number'],
        [true, 'bool', 'boolean'],
        ['{"a":1}', 'json', 'json'],
        ['[1,2]', 'text', 'json'],
        ['2026-10-16 10:00:00', 'datetime', 'date'],
        ['[binary 12 bytes]', 'blob', 'binary'],
        ['hello', 'varchar', 'text'],
    ] as const)('%s (%s) → %s', (value, type, kind) => {
        expect(cellKind(value, type)).toBe(kind);
    });

    it('detects long values', () => {
        expect(isLong('a'.repeat(121))).toBe(true);
        expect(isLong('a\nb')).toBe(true);
        expect(isLong('short')).toBe(false);
    });

    it('finds the referenced table for an FK column', () => {
        const s = makeSnapshot(
            [{ name: 'orders' }, { name: 'users' }],
            [
                {
                    from_table: 'orders',
                    to_table: 'users',
                    from_columns: ['user_id'],
                },
            ],
        );
        expect(
            fkTarget({ name: 'user_id', type: 'int', table: 'orders' }, s),
        ).toEqual({ table: 'users', column: 'id' });
        expect(
            fkTarget({ name: 'user_id', type: 'int', table: null }, s),
        ).toBeNull();
    });
});

describe('object-valued cells', () => {
    it('renders objects and arrays as JSON, never [object Object]', () => {
        expect(cellText({ a: 1, b: [2] })).toBe('{"a":1,"b":[2]}');
        expect(cellText([1, 'x'])).toBe('[1,"x"]');
        expect(cellKind({ a: 1 }, 'jsonb')).toBe('json');
    });

    it('keeps scalar rendering', () => {
        expect(cellText(null)).toBe('');
        expect(cellText(3)).toBe('3');
        expect(cellText(false)).toBe('false');
        expect(cellText('hi')).toBe('hi');
    });
});

describe('cell display helpers', () => {
    it('detects empty strings and binary placeholders', () => {
        expect(isEmptyString('')).toBe(true);
        expect(isEmptyString(' ')).toBe(false);
        expect(isEmptyString(null)).toBe(false);
        expect(binaryBytes('[binary 12288 bytes]')).toBe(12288);
        expect(binaryBytes('binary')).toBeNull();
        expect(binaryBytes(5)).toBeNull();
    });

    it('builds the blob label and the truncation title', () => {
        expect(blobLabel('[binary 12288 bytes]')).toBe('‹blob 12 KB›');
        expect(blobLabel('[binary 5 bytes]')).toBe('‹blob 5 B›');
        expect(cellTitle('a'.repeat(700))).toBe('a'.repeat(500));
        expect(cellTitle('😀'.repeat(600))).toBe('😀'.repeat(500));
    });
});
