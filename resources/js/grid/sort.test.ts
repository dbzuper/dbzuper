import { describe, expect, it } from 'vitest';
import { sortRows } from './sort';

describe('sortRows', () => {
    it('sorts numbers numerically and puts nulls last', () => {
        const rows = [[10], [null], [2], ['1']];
        expect(sortRows(rows, 0, 'ASC').map((r) => r[0])).toEqual([
            '1',
            2,
            10,
            null,
        ]);
        expect(sortRows(rows, 0, 'DESC').map((r) => r[0])).toEqual([
            10,
            2,
            '1',
            null,
        ]);
    });

    it('sorts text naturally', () => {
        expect(
            sortRows([['b10'], ['b2'], ['a']], 0, 'ASC').map((r) => r[0]),
        ).toEqual(['a', 'b2', 'b10']);
    });
});
