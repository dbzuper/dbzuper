import { afterEach, describe, expect, it, vi } from 'vitest';
import { toCSV, toInsert, toJSON, toTSV, writeClipboard } from './copy';

const columns = [
    { name: 'id', type: 'int', table: null },
    { name: 'note', type: 'text', table: null },
    { name: 'id', type: 'int', table: null },
];
const rows = [
    [1, 'plain', 9],
    [2, 'has, comma "quote"\nnewline', null],
    [3, 'émoji 🚀', 7],
];

describe('copy formats', () => {
    it('TSV escapes tabs and newlines', () => {
        expect(toTSV(columns, [[1, 'a\tb\nc', null]])).toBe(
            'id\tnote\tid\n1\ta\\tb\\nc\t',
        );
    });

    it('CSV follows RFC 4180', () => {
        expect(toCSV(columns, rows)).toBe(
            'id,note,id\r\n1,plain,9\r\n2,"has, comma ""quote""\nnewline",\r\n3,émoji 🚀,7\r\n',
        );
    });

    it('JSON de-duplicates column names and keeps nulls', () => {
        expect(JSON.parse(toJSON(columns, rows.slice(1, 2)))).toEqual([
            { id: 2, note: 'has, comma "quote"\nnewline', id_2: null },
        ]);
    });
});

describe('toJSON keys', () => {
    it('never collides with an existing suffixed column name', () => {
        const cols = ['id', 'id', 'id_2'].map((name) => ({
            name,
            type: null,
            table: null,
        }));
        const [row] = JSON.parse(toJSON(cols, [[1, 2, 3]]));
        expect(Object.keys(row)).toEqual(['id', 'id_3', 'id_2']);
        expect(row).toEqual({ id: 1, id_3: 2, id_2: 3 });
    });
});

describe('writeClipboard', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('returns false when the Clipboard API is unavailable', async () => {
        vi.stubGlobal('navigator', {});
        await expect(writeClipboard('x')).resolves.toBe(false);
    });

    it('returns false when the write is rejected', async () => {
        vi.stubGlobal('navigator', {
            clipboard: { writeText: () => Promise.reject(new Error('no')) },
        });
        await expect(writeClipboard('x')).resolves.toBe(false);
    });

    it('writes and returns true', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        await expect(writeClipboard('x')).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith('x');
    });
});

describe('toInsert', () => {
    const columns = [
        { name: 'id', type: 'integer', table: 'users' },
        { name: 'na"me', type: 'text', table: 'users' },
        { name: 'ok', type: 'boolean', table: 'users' },
    ];
    it('quotes per dialect and escapes values', () => {
        expect(
            toInsert('pgsql', 'users', columns, [
                [1, "O'Brien", true],
                [2, null, false],
            ]),
        ).toBe(
            'INSERT INTO "users" ("id", "na""me", "ok") VALUES\n' +
                "(1, 'O''Brien', TRUE),\n" +
                '(2, NULL, FALSE);',
        );
        expect(
            toInsert('mysql', 'order items', columns.slice(0, 1), [[1]]),
        ).toBe('INSERT INTO `order items` (`id`) VALUES\n(1);');
        expect(
            toInsert(
                'mariadb',
                'a`b',
                [{ name: 'x', type: 'text', table: 'a`b' }],
                [['back\\slash']],
            ),
        ).toBe("INSERT INTO `a``b` (`x`) VALUES\n('back\\\\slash');");
    });
    it('writes numeric strings from numeric columns unquoted and objects as JSON text', () => {
        expect(
            toInsert(
                'sqlite',
                't',
                [
                    { name: 'n', type: 'decimal(10,2)', table: 't' },
                    { name: 'j', type: 'json', table: 't' },
                ],
                [['12.50', { a: 1 } as never]],
            ),
        ).toBe('INSERT INTO "t" ("n", "j") VALUES\n(12.50, \'{"a":1}\');');
    });
});
