import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syntheticSnapshot } from '@/universe/__fixtures__/synthetic';
import { assignClusters } from '@/universe/clusters';
import { buildSchemaGraph } from '@/universe/graph';
import { useWorkspace } from '@/universe/store';
import { UniverseCanvas } from './universe-canvas';

const sigmaCalls = vi.hoisted(() => ({
    constructed: 0,
    refresh: 0,
    scheduleRender: 0,
}));

vi.mock('sigma/rendering', () => ({
    layerDashed: () => ({}),
    layerPlain: () => ({}),
    pathCurved: () => ({}),
    pathLoop: () => ({}),
}));

vi.mock('sigma', () => {
    class FakeSigma {
        private camera = {
            getState: () => ({ x: 0.5, y: 0.5, angle: 0, ratio: 1 }),
            setState: () => undefined,
            on: () => undefined,
            removeListener: () => undefined,
            animate: () => Promise.resolve(),
            reset: () => Promise.resolve(),
        };
        constructor(private graph: unknown) {
            sigmaCalls.constructed++;
        }
        getGraph() {
            return this.graph;
        }
        getCamera() {
            return this.camera;
        }
        on() {
            return this;
        }
        once() {
            return this;
        }
        removeListener() {
            return this;
        }
        refresh() {
            sigmaCalls.refresh++;
            return this;
        }
        scheduleRender() {
            sigmaCalls.scheduleRender++;
            return this;
        }
        kill() {}
        getDimensions() {
            return { width: 800, height: 600 };
        }
        graphToViewport(p: { x: number; y: number }) {
            return p;
        }
        getNodeDisplayData() {
            return undefined;
        }
    }
    return { default: FakeSigma };
});

afterEach(() => useWorkspace.getState().reset());

describe('UniverseCanvas', () => {
    it('mounts a large graph with a single render: no re-index refresh and no extra scheduled frame', async () => {
        useWorkspace.getState().reset();
        const snapshot = syntheticSnapshot(200);
        const graph = buildSchemaGraph(snapshot);
        const model = { graph, clusters: assignClusters(graph) };

        render(
            <UniverseCanvas
                model={model}
                snapshot={snapshot}
                onRelayout={() => undefined}
                onPositionsChanged={() => undefined}
                onError={() => undefined}
            />,
        );

        await waitFor(() =>
            expect(
                screen.getByRole('img', { name: /Schema universe of 200/ }),
            ).toHaveAttribute('data-universe-ready', 'true'),
        );
        expect(sigmaCalls.constructed).toBe(1);
        expect(useWorkspace.getState().zoomLevel).toBe('galaxy');
        expect(sigmaCalls.refresh).toBe(0);
        expect(sigmaCalls.scheduleRender).toBe(0);
    });
});
