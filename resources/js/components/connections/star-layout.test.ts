import { describe, expect, it } from 'vitest';
import { starPoints } from '@/components/connections/star-layout';

describe('starPoints', () => {
    it('returns count points inside the unit square, deterministically', () => {
        const a = starPoints(7, 30, null);

        expect(a).toHaveLength(30);
        expect(a.flat().every((n) => n >= 0 && n <= 1)).toBe(true);
        expect(starPoints(7, 30, null)).toEqual(a);
    });

    it('keeps given points at their indexes and fills nulls', () => {
        const pts = starPoints(3, 5, [[0.1, 0.2], null, [0.9, 0.8]]);

        expect(pts).toHaveLength(5);
        expect(pts[0]).toEqual([0.1, 0.2]);
        expect(pts[2]).toEqual([0.9, 0.8]);
        expect(pts[1]).toEqual(starPoints(3, 5, null)[1]);
    });

    it('differs per seed', () => {
        expect(starPoints(1, 20, null)).not.toEqual(starPoints(2, 20, null));
    });
});
