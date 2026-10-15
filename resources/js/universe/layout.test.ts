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

const innerKeys = () =>
    ['a', 'b'].flatMap((prefix) => [0, 1, 2, 3, 4].map((i) => `${prefix}${i}`));

/** Centre, radius and median edge length of the connected core. */
function coreGeometry(
    p: Record<string, { x: number; y: number }>,
    inner: string[],
) {
    const cx = inner.reduce((s, k) => s + p[k].x, 0) / inner.length;
    const cy = inner.reduce((s, k) => s + p[k].y, 0) / inner.length;
    const rmax = Math.max(...inner.map((k) => dist(p[k], { x: cx, y: cy })));
    const lengths = twoCliques()
        .edges.map((e) => dist(p[e.source], p[e.target]))
        .sort((a, b) => a - b);
    const spacing = lengths[Math.floor(lengths.length / 2)];
    return { cx, cy, rmax, spacing };
}

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

    it('puts a few unrelated tables in a compact column left of the core', () => {
        const p = computeLayout(twoCliques());
        const inner = innerKeys();
        const { cy, rmax, spacing } = coreGeometry(p, inner);
        const minX = Math.min(...inner.map((k) => p[k].x));
        for (const k of ['lonely', 'solo']) {
            expect(p[k].x).toBeCloseTo(minX - spacing, 5);
            expect(Math.abs(p[k].y - cy)).toBeLessThan(rmax);
        }
        expect(Math.abs(p.lonely.y - p.solo.y)).toBeCloseTo(spacing, 5);
    });

    it('rings many unrelated tables close to the core', () => {
        const input = twoCliques();
        for (let i = 0; i < 10; i++)
            input.nodes.push({ key: `iso${i}`, cluster: 'isolated', size: 5 });
        const p = computeLayout(input);
        const { cx, cy, rmax, spacing } = coreGeometry(p, innerKeys());
        const outer = input.nodes
            .filter((n) => n.cluster === 'isolated')
            .map((n) => dist(p[n.key], { x: cx, y: cy }));
        for (const d of outer) {
            expect(d).toBeGreaterThan(rmax);
            expect(d).toBeLessThan(rmax + 3 * spacing);
        }
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
