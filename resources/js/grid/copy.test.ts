import { afterEach, describe, expect, it, vi } from 'vitest';
import { toCSV, toJSON, toTSV, writeClipboard } from './copy';

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
