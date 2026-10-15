import { describe, expect, it } from 'vitest';
import { makeSnapshot } from './__fixtures__/snapshot';
import { assignClusters } from './clusters';
import { buildSchemaGraph } from './graph';
import { applyPositions, planLayout, savedMap, toLayoutEntries } from './plan';

function setup(names: string[]) {
    const graph = buildSchemaGraph(
        makeSnapshot(
            names.map((name) => ({ name })),
            [{ from_table: names[0], to_table: names[1] }],
        ),
    );
    return { graph, clusters: assignClusters(graph) };
}

describe('planLayout', () => {
    it('reuses a complete saved layout without running the layout', () => {
        const { graph, clusters } = setup(['a', 'b']);
        const saved = savedMap([
            { table: 'a', x: 1, y: 2, pinned: false },
            { table: 'b', x: 3, y: 4, pinned: true },
            { table: 'removed', x: 9, y: 9, pinned: true },
        ]);
        const plan = planLayout(graph, clusters, saved, false);
        expect(plan.input).toBeNull();
        expect(plan.complete).toEqual({ a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });
        expect([...plan.pinned]).toEqual(['b']);
    });

    it('lays out only new tables around fixed existing ones', () => {
        const { graph, clusters } = setup(['a', 'b', 'c']);
        const plan = planLayout(
            graph,
            clusters,
            savedMap([
                { table: 'a', x: 1, y: 2, pinned: false },
                { table: 'b', x: 3, y: 4, pinned: false },
            ]),
            false,
        );
        expect(plan.complete).toBeNull();
        const byKey = Object.fromEntries(
            plan.input!.nodes.map((n) => [n.key, n]),
        );
        expect(byKey.a.fixed).toEqual({ x: 1, y: 2 });
        expect(byKey.b.fixed).toEqual({ x: 3, y: 4 });
        expect(byKey.c.fixed).toBeUndefined();
    });

    it('keeps only pinned tables fixed on re-layout', () => {
        const { graph, clusters } = setup(['a', 'b']);
        const plan = planLayout(
            graph,
            clusters,
            savedMap([
                { table: 'a', x: 1, y: 2, pinned: true },
                { table: 'b', x: 3, y: 4, pinned: false },
            ]),
            true,
        );
        const byKey = Object.fromEntries(
            plan.input!.nodes.map((n) => [n.key, n]),
        );
        expect(byKey.a.fixed).toEqual({ x: 1, y: 2 });
        expect(byKey.b.fixed).toBeUndefined();
    });

    it('produces an empty input for an empty graph', () => {
        const graph = buildSchemaGraph(makeSnapshot([]));
        const plan = planLayout(graph, [], new Map(), false);
        expect(plan.complete).toBeNull();
        expect(plan.input!.nodes).toEqual([]);
    });
});

describe('applyPositions / toLayoutEntries', () => {
    it('round-trips positions and pinned flags', () => {
        const { graph } = setup(['a', 'b']);
        applyPositions(
            graph,
            { a: { x: 5, y: 6 }, b: { x: 7, y: 8 } },
            new Set(['a']),
        );
        expect(toLayoutEntries(graph)).toEqual([
            { table: 'a', x: 5, y: 6, pinned: true },
            { table: 'b', x: 7, y: 8, pinned: false },
        ]);
    });
});
