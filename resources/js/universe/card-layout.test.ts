import { describe, expect, it } from 'vitest';
import { deOverlapCards, type CardBox } from './card-layout';

const intersects = (a: CardBox, b: CardBox) =>
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2;

function resolved(boxes: CardBox[], gap = 8): CardBox[] {
    const dy = deOverlapCards(boxes, gap);
    return boxes.map((b) => ({ ...b, y: b.y + (dy.get(b.key) ?? 0) }));
}

describe('deOverlapCards', () => {
    it('terminates when floating-point round-off leaves the pushed card a hair short of the gap', () => {
        // Captured from a 200-table schema that froze the page at close zoom:
        // (495.96087187159884 + 123) - 495.96087187159884 === 122.99999999999994 < 123.
        const boxes = [
            {
                key: 'm004_t04',
                x: 0,
                y: 495.96087187159884,
                width: 224,
                height: 125,
            },
            { key: 'm004_t05', x: 0, y: 542.17, width: 224, height: 105 },
        ];
        const out = resolved(boxes, 8);
        expect(out[1].y - out[0].y).toBeCloseTo(123, 9);
    });

    it('leaves cards that already clear each other alone', () => {
        const boxes = [
            { key: 'a', x: 0, y: 0, width: 224, height: 100 },
            { key: 'b', x: 300, y: 10, width: 224, height: 100 },
        ];
        expect(
            [...deOverlapCards(boxes, 8).values()].every((d) => d === 0),
        ).toBe(true);
    });

    it('keeps a minimum gap between stacked cards, moving y only', () => {
        const boxes = [
            { key: 'products', x: 0, y: 0, width: 224, height: 120 },
            { key: 'categories', x: 40, y: 30, width: 224, height: 120 },
        ];
        const out = resolved(boxes, 8);
        expect(out[1].y - out[0].y).toBeGreaterThanOrEqual(120 + 8);
        expect(out[0].y).toBe(0);
    });

    it('leaves no two of many crowded cards intersecting', () => {
        const boxes: CardBox[] = Array.from({ length: 30 }, (_, i) => ({
            key: `t${i}`,
            x: (i % 4) * 90,
            y: Math.floor(i / 4) * 25,
            width: 224,
            height: 60 + (i % 5) * 20,
        }));
        const out = resolved(boxes);
        for (let i = 0; i < out.length; i++)
            for (let j = i + 1; j < out.length; j++)
                expect(intersects(out[i], out[j])).toBe(false);
    });

    it('is deterministic for identical positions', () => {
        const boxes = ['b', 'a', 'c'].map((key) => ({
            key,
            x: 0,
            y: 0,
            width: 100,
            height: 50,
        }));
        const byKey = ([a]: [string, number], [b]: [string, number]) =>
            a < b ? -1 : 1;
        const first = [...deOverlapCards(boxes, 4)].sort(byKey);
        expect(
            [...deOverlapCards([...boxes].reverse(), 4)].sort(byKey),
        ).toEqual(first);
    });
});
