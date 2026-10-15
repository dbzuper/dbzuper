import { describe, expect, it } from 'vitest';
import { makeSnapshot } from './__fixtures__/snapshot';
import { fkColumnsByTable, pickCardNodes, stableCardKeys } from './visible';

describe('pickCardNodes', () => {
    it('keeps nodes within the viewport plus margin, nearest to centre first, capped', () => {
        const pts = [
            { key: 'centre', x: 500, y: 300 },
            { key: 'near', x: 560, y: 320 },
            { key: 'edge', x: 1030, y: 300 },
            { key: 'outside', x: 1300, y: 300 },
            { key: 'above', x: 500, y: -200 },
        ];
        expect(pickCardNodes(pts, 1000, 600, 10, 50)).toEqual([
            'centre',
            'near',
            'edge',
        ]);
        expect(pickCardNodes(pts, 1000, 600, 2, 50)).toEqual([
            'centre',
            'near',
        ]);
    });
});

describe('fkColumnsByTable', () => {
    it('separates declared and inferred FK columns', () => {
        const snap = makeSnapshot(
            [{ name: 'orders' }, { name: 'users' }],
            [
                {
                    from_table: 'orders',
                    to_table: 'users',
                    from_columns: ['user_id'],
                },
                {
                    from_table: 'orders',
                    to_table: 'users',
                    from_columns: ['approver_id'],
                    inferred: true,
                },
            ],
        );
        const fk = fkColumnsByTable(snap).get('orders')!;
        expect([...fk.declared]).toEqual(['user_id']);
        expect([...fk.inferred]).toEqual(['approver_id']);
    });
});

describe('stableCardKeys', () => {
    it('is identical when only the distance order changes', () => {
        const a = [
            { key: 'b', x: 500, y: 300 },
            { key: 'a', x: 520, y: 300 },
            { key: 'c', x: 5000, y: 300 },
        ];
        const b = [
            { key: 'b', x: 540, y: 300 },
            { key: 'a', x: 500, y: 300 },
            { key: 'c', x: 5000, y: 300 },
        ];
        expect(pickCardNodes(a, 1000, 600, 2)).not.toEqual(
            pickCardNodes(b, 1000, 600, 2),
        );
        expect(stableCardKeys(a, 1000, 600, 2)).toEqual(['a', 'b']);
        expect(stableCardKeys(b, 1000, 600, 2)).toEqual(['a', 'b']);
    });
});
