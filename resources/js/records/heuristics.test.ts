import { describe, expect, it } from 'vitest';
import { recordFields, recordTitle, titleColumn } from './heuristics';

const cols = (...names: [string, string][]) =>
    names.map(([name, type]) => ({ name, type }));

describe('record heuristics', () => {
    it('picks the first title-like column, case-insensitively, in priority order', () => {
        expect(
            titleColumn(
                cols(['id', 'int'], ['Email', 'varchar'], ['name', 'varchar']),
            ),
        ).toBe('name');
        expect(titleColumn(cols(['id', 'int'], ['EMAIL', 'varchar']))).toBe(
            'EMAIL',
        );
        expect(titleColumn(cols(['id', 'int'], ['qty', 'int']))).toBeNull();
    });

    it('falls back to the primary key values', () => {
        expect(
            recordTitle(
                cols(['product_id', 'int'], ['tag', 'varchar']),
                [1, 'rgb'],
                ['product_id', 'tag'],
            ),
        ).toBe('1 · rgb');
        expect(
            recordTitle(
                cols(['id', 'int'], ['name', 'varchar']),
                [1, null],
                ['id'],
            ),
        ).toBe('1');
    });

    it('chooses up to 5 short scalar fields, primary key first, skipping the title, binary, JSON and long values', () => {
        const c = cols(
            ['email', 'varchar'],
            ['id', 'int'],
            ['name', 'varchar'],
            ['avatar', 'blob'],
            ['profile', 'json'],
            ['bio', 'text'],
            ['a', 'int'],
            ['b', 'int'],
            ['c', 'int'],
            ['d', 'int'],
        );
        const v = [
            'x@y.z',
            7,
            'Ada',
            '[binary 3 bytes]',
            '{"a":1}',
            'z'.repeat(81),
            1,
            2,
            3,
            4,
        ];
        expect(recordFields(c, v, ['id'], 'name').map((f) => f.name)).toEqual([
            'id',
            'email',
            'a',
            'b',
            'c',
        ]);
    });
});
