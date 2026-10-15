import { describe, expect, it } from 'vitest';
import { computeLayout, iterationsFor, type LayoutInput } from './layout';

function twoCliques(): LayoutInput {
    const nodes = [];
    const edges = [];
    for (const [cluster, prefix] of [
        ['c0', 'a'],
        ['c1', 'b'],
    ] as const) {
        for (let i = 0; i < 5; i++)
            nodes.push({ key: `${prefix}${i}`, cluster, size: 5 });
        for (let i = 0; i < 5; i++)
            for (let j = i + 1; j < 5; j++)
                edges.push({
                    source: `${prefix}${i}`,
                    target: `${prefix}${j}`,
                    weight: 1,
                });
    }
    edges.push({ source: 'a0', target: 'b0', weight: 1 });
    nodes.push(
        { key: 'lonely', cluster: 'isolated', size: 5 },
        { key: 'solo', cluster: 'isolated', size: 5 },
    );
    return {
        nodes,
        edges,
        clusters: [
            { id: 'c0', outer: false },
            { id: 'c1', outer: false },
            { id: 'isolated', outer: true },
        ],
    };
}

const dist = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    Math.hypot(p.x - q.x, p.y - q.y);

describe('computeLayout', () => {
    it('is deterministic and finite', () => {
        const a = computeLayout(twoCliques());
        const b = computeLayout(twoCliques());
        expect(a).toEqual(b);
        for (const p of Object.values(a))
            expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    });

    it('keeps clusters cohesive', () => {
        const p = computeLayout(twoCliques());
        const intra = (dist(p.a1, p.a2) + dist(p.b1, p.b2)) / 2;
        const inter = (dist(p.a1, p.b2) + dist(p.a2, p.b1)) / 2;
        expect(intra).toBeLessThan(inter);
    });

    it('places unrelated tables on an outer ring', () => {
        const p = computeLayout(twoCliques());
        const inner = [
            'a0',
            'a1',
            'a2',
            'a3',
            'a4',
            'b0',
            'b1',
            'b2',
            'b3',
            'b4',
        ];
        const cx = inner.reduce((s, k) => s + p[k].x, 0) / inner.length;
        const cy = inner.reduce((s, k) => s + p[k].y, 0) / inner.length;
        const rmax = Math.max(
            ...inner.map((k) => dist(p[k], { x: cx, y: cy })),
        );
        expect(dist(p.lonely, { x: cx, y: cy })).toBeGreaterThan(rmax);
        expect(dist(p.solo, { x: cx, y: cy })).toBeGreaterThan(rmax);
    });

    it('never moves fixed nodes', () => {
        const input = twoCliques();
        input.nodes[0] = { ...input.nodes[0], fixed: { x: 123, y: -45 } };
        expect(computeLayout(input).a0).toEqual({ x: 123, y: -45 });
    });

    it('handles empty, single-node and edgeless inputs', () => {
        expect(computeLayout({ nodes: [], edges: [], clusters: [] })).toEqual(
            {},
        );
        const one = computeLayout({
            nodes: [{ key: 't', cluster: 'isolated', size: 5 }],
            edges: [],
            clusters: [{ id: 'isolated', outer: true }],
        });
        expect(Object.keys(one)).toEqual(['t']);
        const edgeless = computeLayout({
            nodes: [
                { key: 'x', cluster: 'c0', size: 5 },
                { key: 'y', cluster: 'c0', size: 5 },
            ],
            edges: [],
            clusters: [{ id: 'c0', outer: false }],
        });
        expect(edgeless.x).not.toEqual(edgeless.y);
    });

    it('scales iterations down for large graphs', () => {
        expect(iterationsFor(100)).toBeGreaterThan(iterationsFor(2000));
    });
});
