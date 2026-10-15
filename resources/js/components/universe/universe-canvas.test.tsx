import { act, render, screen, waitFor } from '@testing-library/react';
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
    resize: 0,
}));

type RoCallback = (entries: { contentRect: DOMRect }[]) => void;
const observers = vi.hoisted(() => ({
    callbacks: [] as unknown[],
    disconnected: 0,
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
        resize() {
            sigmaCalls.resize++;
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
        getNodeDisplayedLabels() {
            return new Set(['t0', 't1', 't2']);
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
        expect(
            screen.getByRole('img', { name: /Schema universe of 200/ }),
        ).toHaveAttribute('data-labels-shown', '3');
        expect(useWorkspace.getState().zoomLevel).toBe('galaxy');
        expect(sigmaCalls.refresh).toBe(0);
        expect(sigmaCalls.scheduleRender).toBe(0);
    });

    it('rebuilds for a theme switch but not for unrelated class changes on <html>', async () => {
        const snapshot = syntheticSnapshot(20);
        const graph = buildSchemaGraph(snapshot);
        const model = { graph, clusters: assignClusters(graph) };
        const root = document.documentElement;
        root.classList.remove('dark');

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
                screen.getByRole('img', { name: /Schema universe of 20/ }),
            ).toHaveAttribute('data-universe-ready', 'true'),
        );
        const before = sigmaCalls.constructed;

        await act(async () => {
            root.classList.add('some-unrelated-class');
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(sigmaCalls.constructed).toBe(before);

        await act(async () => {
            root.classList.add('dark');
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(sigmaCalls.constructed).toBe(before + 1);

        root.classList.remove('dark', 'some-unrelated-class');
    });
});

describe('UniverseCanvas resize', () => {
    class FakeResizeObserver {
        constructor(cb: RoCallback) {
            observers.callbacks.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {
            observers.disconnected++;
        }
    }

    it('resizes Sigma once per frame when the container size changes, skips unchanged sizes, and disconnects', async () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const frames: FrameRequestCallback[] = [];
        const raf = vi
            .spyOn(window, 'requestAnimationFrame')
            .mockImplementation((cb) => frames.push(cb));
        observers.callbacks.length = 0;
        observers.disconnected = 0;
        const snapshot = syntheticSnapshot(20);
        const graph = buildSchemaGraph(snapshot);
        const model = { graph, clusters: assignClusters(graph) };
        const { unmount } = render(
            <UniverseCanvas
                model={model}
                snapshot={snapshot}
                onRelayout={() => undefined}
                onPositionsChanged={() => undefined}
                onError={() => undefined}
            />,
        );
        const flush = () => frames.splice(0).forEach((cb) => cb(0));
        flush();
        const notify = (width: number, height: number) =>
            act(() => {
                (observers.callbacks[0] as RoCallback)([
                    { contentRect: { width, height } as DOMRect },
                ]);
            });
        const base = sigmaCalls.resize;
        const baseRender = sigmaCalls.scheduleRender;

        // The initial notification repeats Sigma's own size, so there is nothing to do.
        notify(800, 600);
        flush();
        expect(sigmaCalls.resize).toBe(base);

        // Several notifications within one frame collapse into one resize.
        notify(480, 600);
        notify(480.2, 600);
        notify(480, 600.3);
        expect(sigmaCalls.resize).toBe(base);
        flush();
        expect(sigmaCalls.resize).toBe(base + 1);
        expect(sigmaCalls.scheduleRender).toBe(baseRender + 1);

        // Same size again: nothing to do.
        notify(480, 600);
        flush();
        expect(sigmaCalls.resize).toBe(base + 1);

        unmount();
        expect(observers.disconnected).toBe(1);
        raf.mockRestore();
        vi.unstubAllGlobals();
    });
});
