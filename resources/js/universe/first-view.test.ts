import { describe, expect, it, vi } from 'vitest';

// sigma/rendering reads WebGL2RenderingContext constants at import time; jsdom has none.
vi.mock('sigma/rendering', () => ({
    layerDashed: () => ({}),
    layerPlain: () => ({}),
    pathCurved: () => ({}),
    pathLoop: () => ({}),
}));

import { makeSnapshot } from './__fixtures__/snapshot';
import { assignClusters } from './clusters';
import { buildSchemaGraph } from './graph';
import { computeLayout } from './layout';
import { planLayout, savedMap } from './plan';
import { buildDisplayState, nodeDisplay } from './reducers';
import { universeSettings } from './sigma-options';
import { firstViewRatio, zoomLevelFor } from './zoom';

const colors = {
    accent: '#0ff',
    dimNode: '#333',
    edge: '#444',
    edgeInferred: '#555',
    edgeDim: '#222',
    label: '#fff',
    background: '#000',
};

/** A schema of `n` tables: a chain of foreign keys plus a few unrelated ones. */
function schema(n: number) {
    const names = Array.from({ length: n }, (_, i) => `t${i}`);
    return makeSnapshot(
        names.map((name, i) => ({
            name,
            row_count: { count: i % 7 === 0 ? 100000 : i, kind: 'exact' },
        })),
        names
            .slice(1, n - 5)
            .map((name, i) => ({ from_table: name, to_table: names[i] })),
    );
}

describe.each([30, 90])('first view of a %i-table schema', (n) => {
    const graph = buildSchemaGraph(schema(n));
    const clusters = assignClusters(graph);
    const plan = planLayout(graph, clusters, savedMap([]), false);
    const positions = computeLayout(plan.input!);

    it('draws the median node at least as large as the label threshold', () => {
        const sizes = graph.mapNodes((_k, a) => a.size).sort((a, b) => a - b);
        const median = sizes[Math.floor(sizes.length / 2)];
        // Node sizes are screen pixels (itemSizesReference: 'screen'), whatever the camera ratio.
        expect(universeSettings(n).itemSizesReference).toBe('screen');
        expect(median).toBeGreaterThanOrEqual(
            universeSettings(n).labelRenderedSizeThreshold ?? 0,
        );
        expect(Object.keys(positions)).toHaveLength(n);
    });

    it('opens at a zoom level whose labels the reducer lets Sigma draw', () => {
        const level = zoomLevelFor(firstViewRatio(n), n);
        expect(level).toBe('system');
        const display = buildDisplayState(
            graph,
            {
                hovered: null,
                selected: null,
                path: null,
                focus: null,
                showInferred: true,
                zoomLevel: level,
            },
            colors,
        );
        const shown = graph
            .mapNodes((key, attrs) => nodeDisplay(key, attrs, display))
            .filter((d) => d.labelVisibility === 'auto');
        expect(shown).toHaveLength(n);
    });
});

describe('first view padding', () => {
    it('pads labelled graphs and leaves large ones fitted', () => {
        expect(firstViewRatio(30)).toBeGreaterThan(1);
        expect(firstViewRatio(100)).toBeGreaterThan(1);
        expect(firstViewRatio(2000)).toBe(1);
    });
});
