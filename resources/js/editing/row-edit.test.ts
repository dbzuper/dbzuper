import { describe, expect, it } from 'vitest';
import type { QueryColumn } from '@/types/schema';
import { refOf } from './pending-store';
import {
    boolValue,
    committedValue,
    editorText,
    EMPTY_NOT_NULL,
    jsonError,
    lineEndProblem,
    lockedFor,
    restoreLineEnds,
    rowTarget,
    truthy,
    UNPINNED_ROW,
    type GridEditing,
} from './row-edit';

const columns: QueryColumn[] = [
    { name: 'id', type: 'integer', table: 'users' },
    { name: 'name', type: 'text', table: 'users' },
    { name: 'avatar', type: 'blob', table: 'users' },
    { name: 'slug', type: 'text', table: 'users' },
];

const editing = (over: Partial<GridEditing> = {}): GridEditing => ({
    connectionId: 1,
    table: 'users',
    dialect: 'mysql',
    rowIds: [{ key: { id: 1 } }, null],
    locked: [[2, 3], []],
    shortened: [[2], []],
    readOnlyColumns: ['slug'],
    rowReason: null,
    tableColumns: [],
    ...over,
});

describe('rowTarget', () => {
    it('builds the target of a loaded row with its shortened cells left out', () => {
        expect(
            rowTarget(editing(), columns, 0, [
                1,
                'Ada',
                '[binary 3 bytes]',
                'ada',
            ]),
        ).toEqual({
            ref: refOf({ key: { id: 1 } }),
            id: { key: { id: 1 } },
            original: { id: 1, name: 'Ada', slug: 'ada' },
            shortened: ['avatar'],
        });
    });

    it('has no target for a row without an identity', () => {
        expect(
            rowTarget(editing(), columns, 1, [2, 'B', null, 'b']),
        ).toBeNull();
    });
});

describe('lockedFor', () => {
    const cells = [1, 'Ada', '[binary 3 bytes]', 'ada'];
    it('explains why a cell is locked, like the grid', () => {
        const e = editing();
        expect(lockedFor(e, columns, 0, cells, 1)).toBeNull();
        expect(lockedFor(e, columns, 0, cells, 2)).toBe('binary');
        expect(lockedFor(e, columns, 0, cells, 3)).toBe('generated column');
        expect(
            lockedFor(editing({ readOnlyColumns: [] }), columns, 0, cells, 3),
        ).toBe("its values can't be compared exactly");
        expect(
            lockedFor(
                editing({ shortened: [[3], []], readOnlyColumns: [] }),
                columns,
                0,
                cells,
                3,
            ),
        ).toBe('shortened for display');
    });

    it('calls a binary column binary, though the server lists it read-only too', () => {
        // The rows response puts binary columns in read_only_columns along with generated ones.
        const e = editing({ readOnlyColumns: ['avatar', 'slug'] });
        expect(lockedFor(e, columns, 0, [1, 'Ada', null, 'ada'], 2)).toBe(
            'binary',
        );
        expect(lockedFor(e, columns, 0, cells, 3)).toBe('generated column');
    });

    it('locks every cell of a row that cannot be pinned', () => {
        expect(lockedFor(editing(), columns, 1, cells, 1)).toBe(UNPINNED_ROW);
        expect(
            lockedFor(editing({ rowReason: 'no key' }), columns, 1, cells, 1),
        ).toBe('no key');
    });
});

describe('values', () => {
    it('stores booleans per engine', () => {
        expect(boolValue('pgsql', true)).toBe('true');
        expect(boolValue('mysql', false)).toBe('0');
        expect(truthy('t')).toBe(true);
        expect(truthy(0)).toBe(false);
    });

    it('validates JSON', () => {
        expect(jsonError('{"a":1}')).toBeNull();
        expect(jsonError('{a')).toMatch(/^Invalid JSON/);
    });

    it('edits NULL as empty text', () => {
        expect(editorText(null)).toBe('');
        expect(editorText(5)).toBe('5');
    });
});

describe('line ends', () => {
    it('gives an edit the line ends of the value it started from', () => {
        expect(restoreLineEnds('a\r\nb', 'a\nb\nc')).toBe('a\r\nb\r\nc');
        expect(restoreLineEnds('a\rb', 'a\nb2')).toBe('a\rb2');
        expect(restoreLineEnds('a\nb', 'a\nb\nc')).toBe('a\nb\nc');
        expect(restoreLineEnds('ab', 'a\nb')).toBe('a\nb');
    });

    it('refuses a value with mixed line ends, which an editor cannot keep', () => {
        expect(lineEndProblem('a\r\nb\nc')).toMatch(/mixed line ends/);
        expect(lineEndProblem('a\rb\nc')).toMatch(/mixed line ends/);
        expect(lineEndProblem('a\r\nb')).toBeNull();
        expect(lineEndProblem(42)).toBeNull();
    });
});

describe('committedValue', () => {
    const meta = (name: string, type_name: string, nullable = true) => ({
        name,
        type: type_name,
        type_name,
        nullable,
        default: null,
        auto_increment: false,
        comment: null,
    });
    const things = editing({
        tableColumns: [
            meta('created_by', 'integer'),
            meta('qty', 'int', false),
            meta('due', 'date'),
            meta('price', 'decimal'),
            meta('ref', 'uuid'),
            meta('label', 'varchar'),
            meta('code', 'character varying'),
            meta('body', 'longtext'),
            meta('doc', 'jsonb'),
            meta('ci', 'citext'),
            meta('x', 'xml'),
            meta('c', 'clob'),
            meta('status', 'enum', false),
            meta('tags', 'set'),
            meta('title', 'nvarchar', false),
            meta('names', '_text'),
            meta('counts', '_int4', false),
            meta('labels', 'varchar[]'),
        ],
    });

    it.each(['created_by', 'due', 'price', 'ref', 'names', 'labels'])(
        'stages NULL for an emptied nullable %s',
        (column) => {
            expect(committedValue(things, column, '')).toEqual({
                value: null,
            });
        },
    );

    it('refuses an emptied NOT NULL non-text column', () => {
        expect(committedValue(things, 'qty', '')).toEqual({
            error: EMPTY_NOT_NULL,
        });
        expect(committedValue(things, 'counts', '')).toEqual({
            error: EMPTY_NOT_NULL,
        });
        expect(EMPTY_NOT_NULL).toBe(
            "This column can't be empty: enter a value or revert",
        );
    });

    it.each([
        'label',
        'code',
        'body',
        'doc',
        'ci',
        'x',
        'c',
        'status',
        'tags',
        'title',
    ])('keeps an empty string for the text-like %s', (column) => {
        expect(committedValue(things, column, '')).toEqual({ value: '' });
    });

    it('keeps any other text, NULL, and columns of unknown type as they are', () => {
        expect(committedValue(things, 'qty', '0')).toEqual({ value: '0' });
        expect(committedValue(things, 'qty', ' ')).toEqual({ value: ' ' });
        expect(committedValue(things, 'created_by', null)).toEqual({
            value: null,
        });
        expect(committedValue(things, 'unknown', '')).toEqual({ value: '' });
    });
});
