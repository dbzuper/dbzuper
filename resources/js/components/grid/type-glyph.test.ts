import { describe, expect, it } from 'vitest';
import { columnFamily } from './type-glyph';

describe('columnFamily', () => {
    it('shows no family for the ambiguous generic blob type MySQL reports for TEXT', () => {
        expect(columnFamily('blob')).toBeNull();
        expect(columnFamily(' BLOB ')).toBeNull();
    });

    it('keeps binary for unambiguous binary types', () => {
        for (const type of [
            'longblob',
            'tinyblob',
            'blob(255)',
            'bytea',
            'varbinary(16)',
            'binary',
        ])
            expect(columnFamily(type)).toBe('binary');
    });
});
