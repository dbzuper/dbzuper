import { describe, expect, it } from 'vitest';
import { starPoints } from '@/components/connections/star-layout';

const CARD = { width: 446, height: 106 };
const HERO = { width: 1000, height: 220, spread: 1.6, hero: true };

const inUnit = (pts: [number, number][]) =>
    pts.flat().every((n) => n >= 0 && n <= 1);

describe('starPoints', () => {
    it('returns count points inside the unit square, deterministically', () => {
        const a = starPoints(7, 30, null, CARD);

        expect(a).toHaveLength(30);
        expect(inUnit(a)).toBe(true);
        expect(starPoints(7, 30, null, CARD)).toEqual(a);
    });

    it('keeps given points at their indexes and fills nulls', () => {
        const pts = starPoints(3, 5, [[0.1, 0.2], null, [0.9, 0.8]], CARD);

        expect(pts).toHaveLength(5);
        expect(pts[0]).toEqual([0.1, 0.2]);
        expect(pts[2]).toEqual([0.9, 0.8]);
        expect(pts[1]).toEqual(starPoints(3, 5, null, CARD)[1]);
    });

    it('differs per seed', () => {
        expect(starPoints(1, 20, null, CARD)).not.toEqual(
            starPoints(2, 20, null, CARD),
        );
    });

    it('resamples instead of clamping, so no points pile up on the edges', () => {
        for (let seed = 1; seed <= 40; seed++) {
            for (const opts of [CARD, HERO]) {
                const pts = starPoints(seed, 90, null, opts);

                expect(
                    pts.flat().some((n) => n === 0 || n === 1),
                    `seed ${seed}`,
                ).toBe(false);
            }
        }
    });
});

describe('starPoints pixel scatter', () => {
    const xRange = (pts: [number, number][]) =>
        Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));

    it('scatters in pixels: a wider canvas gives a tighter cluster in unit terms', () => {
        const narrow = starPoints(4, 60, null, { width: 400, height: 106 });
        const wide = starPoints(4, 60, null, { width: 1600, height: 106 });

        expect(inUnit(wide)).toBe(true);
        expect(xRange(wide)).toBeLessThan(xRange(narrow));
    });

    it('keeps hero stars right of the text column', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const pts = starPoints(seed, 90, null, HERO);

            // Centres sit at x ≥ 0.35; the horizontal radius is 48 × 1.6 × 1.6 px ≈ 0.123 of 1000px.
            expect(
                Math.min(...pts.map((p) => p[0])),
                `seed ${seed}`,
            ).toBeGreaterThan(0.35 - 0.125);
        }
    });

    it('a wider spread scatters points further, still inside the unit square', () => {
        const dev = (pts: [number, number][]) =>
            pts.reduce(
                (s, [x, y]) => s + Math.abs(x - 0.5) + Math.abs(y - 0.5),
                0,
            );
        const narrow = starPoints(4, 60, null, { ...CARD, spread: 1 });
        const wide = starPoints(4, 60, null, { ...CARD, spread: 1.6 });

        expect(inUnit(wide)).toBe(true);
        expect(dev(wide)).not.toBe(dev(narrow));
    });
});
