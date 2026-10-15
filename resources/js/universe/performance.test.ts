import { describe, expect, it } from 'vitest';
import { syntheticSnapshot } from './__fixtures__/synthetic';
import { assignClusters } from './clusters';
import { buildSchemaGraph } from './graph';
import { computeLayout } from './layout';
import { applyPositions, planLayout, savedMap, toLayoutEntries } from './plan';

describe('2,000-table performance budget', () => {
    const snapshot = syntheticSnapshot(2000);

    it('has roughly 3,000 relationships', () => {
        expect(snapshot.relationships.length).toBeGreaterThan(2800);
    });

    it('computes a first layout within the off-thread budget', () => {
        const t0 = performance.now();
        const graph = buildSchemaGraph(snapshot);
        const clusters = assignClusters(graph);
        const plan = planLayout(graph, clusters, new Map(), false);
        const positions = computeLayout(plan.input!);
        const elapsed = performance.now() - t0;
        console.info(
            `[perf] first layout for 2,000 tables: ${elapsed.toFixed(0)} ms`,
        );
        expect(Object.keys(positions)).toHaveLength(2000);
        expect(elapsed).toBeLessThan(8000);
    }, 20000);

    it('reuses a saved layout in well under the interactive budget', () => {
        const graph = buildSchemaGraph(snapshot);
        const clusters = assignClusters(graph);
        const first = planLayout(graph, clusters, new Map(), false);
        applyPositions(graph, computeLayout(first.input!, 5), new Set());
        const saved = savedMap(toLayoutEntries(graph));

        const t0 = performance.now();
        const g2 = buildSchemaGraph(snapshot);
        const c2 = assignClusters(g2);
        const plan = planLayout(g2, c2, saved, false);
        applyPositions(g2, plan.complete!, plan.pinned);
        const elapsed = performance.now() - t0;
        console.info(
            `[perf] saved-layout reuse for 2,000 tables: ${elapsed.toFixed(0)} ms`,
        );
        expect(elapsed).toBeLessThan(1000);
    }, 20000);
});
