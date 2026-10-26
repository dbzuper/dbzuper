import { useEffect, useRef, useState } from 'react';
import Sigma from 'sigma';
import type { CameraState, NodeDisplayData } from 'sigma/types';
import { openTableTab } from '@/browse/table-actions';
import { watchThemeChanges } from '@/lib/theme-watch';
import type { LayoutPositionEntry, SchemaSnapshot } from '@/types/schema';
import { registerUniverse } from '@/universe/controller';
import type {
    RelationEdgeAttributes,
    SchemaGraph,
    TableNodeAttributes,
} from '@/universe/graph';
import { changedSize, type Size } from '@/universe/container-size';
import { motionMs } from '@/universe/motion';
import { pickPathTarget } from '@/universe/path-pick';
import { toLayoutEntries } from '@/universe/plan';
import {
    buildDisplayState,
    displayInputsChanged,
    edgeDisplay,
    neighborhood,
    nodeDisplay,
    type DisplayState,
} from '@/universe/reducers';
import {
    universePrimitives,
    universeSettings,
    universeStyles,
} from '@/universe/sigma-options';
import { useWorkspace } from '@/universe/store';
import { readUniverseColors } from '@/universe/theme';
import type { UniverseModel } from '@/universe/use-universe-model';
import { firstViewRatio, zoomLevelFor } from '@/universe/zoom';
import { ClusterLabels } from './cluster-labels';
import { Legend } from './legend';
import { TableCards } from './table-cards';
import type { WorkspaceRef } from '@/types/connection';

type Props = {
    connectionId: WorkspaceRef;
    model: UniverseModel;
    snapshot: SchemaSnapshot;
    onRelayout: () => void;
    onPositionsChanged: (entries: LayoutPositionEntry[]) => void;
    onError: (error: unknown) => void;
};

export type UniverseSigma = Sigma<TableNodeAttributes, RelationEdgeAttributes>;

export function UniverseCanvas({
    connectionId,
    model,
    snapshot,
    onRelayout,
    onPositionsChanged,
    onError,
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [sigma, setSigma] = useState<UniverseSigma | null>(null);
    const [ready, setReady] = useState(false);
    const [themeNonce, setThemeNonce] = useState(0);
    // The orange "found it" ping, in container pixels, where a fly-to or a found path lands.
    const [ping, setPing] = useState<{
        x: number;
        y: number;
        id: number;
    } | null>(null);
    const relayoutRef = useRef(onRelayout);
    relayoutRef.current = onRelayout;
    const positionsRef = useRef(onPositionsChanged);
    positionsRef.current = onPositionsChanged;
    const errorRef = useRef(onError);
    errorRef.current = onError;
    const connectionRef = useRef(connectionId);
    connectionRef.current = connectionId;
    // Camera state saved on teardown so a theme rebuild of the same graph keeps the viewport.
    const cameraRef = useRef<{ graph: SchemaGraph; state: CameraState } | null>(
        null,
    );

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const graph = model.graph;
        const colors = readUniverseColors(container);
        // Seed the zoom level for the camera we are about to show, so the display state is built
        // for it up front. Otherwise the first camera update changes a display input and forces a
        // full re-index and re-render straight after the constructor's render.
        const restored =
            cameraRef.current?.graph === graph ? cameraRef.current.state : null;
        useWorkspace
            .getState()
            .setZoomLevel(
                zoomLevelFor(
                    restored?.ratio ?? firstViewRatio(graph.order),
                    graph.order,
                ),
            );
        let display: DisplayState = buildDisplayState(
            graph,
            useWorkspace.getState(),
            colors,
        );

        let instance: UniverseSigma;
        try {
            instance = new Sigma<TableNodeAttributes, RelationEdgeAttributes>(
                graph,
                container,
                {
                    primitives: universePrimitives(),
                    styles: universeStyles(colors),
                    settings: universeSettings(graph.order),
                    nodeReducer: (key, _data, attrs) =>
                        nodeDisplay(key, attrs, display),
                    edgeReducer: (key, _data, attrs) =>
                        edgeDisplay(
                            key,
                            attrs,
                            graph.source(key),
                            graph.target(key),
                            display,
                        ),
                },
            );
        } catch (error) {
            errorRef.current(error);
            return;
        }

        const unsubscribe = useWorkspace.subscribe((next, prev) => {
            if (!displayInputsChanged(prev, next)) return;
            display = buildDisplayState(graph, next, colors);
            instance.refresh({ skipIndexation: true });
        });

        const camera = instance.getCamera();
        // Only move the camera when it has to move: any change costs a re-render, which matters for
        // large graphs that open at Sigma's own fit.
        const initial =
            restored ??
            (firstViewRatio(graph.order) === camera.getState().ratio
                ? null
                : { ...camera.getState(), ratio: firstViewRatio(graph.order) });
        if (initial) camera.setState(initial);
        // The padded first view (see firstViewRatio), animated.
        const resetView = (ms: number) =>
            void camera.animate(
                {
                    x: 0.5,
                    y: 0.5,
                    angle: 0,
                    ratio: firstViewRatio(graph.order),
                },
                { duration: motionMs(ms) },
            );
        let gridSize = '';
        const onCamera = () => {
            const ratio = camera.getState().ratio;
            const ws = useWorkspace.getState();
            ws.setZoomLevel(zoomLevelFor(ratio, graph.order, ws.zoomLevel));
            const size = `${Math.round(Math.min(64, Math.max(8, 24 / ratio)))}px`;
            if (size === gridSize) return;
            gridSize = size;
            container.parentElement?.style.setProperty('--grid-size', size);
        };
        camera.on('updated', onCamera);
        onCamera();

        // How many node labels Sigma drew in the last frame, for tests and debugging.
        let labelsShown = -1;
        const onRendered = () => {
            const n = instance.getNodeDisplayedLabels().size;
            if (n === labelsShown) return;
            labelsShown = n;
            container.dataset.labelsShown = String(n);
        };
        instance.on('afterRender', onRendered);
        onRendered();

        instance.on('enterNode', ({ node }) =>
            useWorkspace.getState().hover(node),
        );
        instance.on('leaveNode', () => useWorkspace.getState().hover(null));
        let justDragged = false;
        instance.on('nodeDragEnd', () => {
            justDragged = true;
            positionsRef.current(toLayoutEntries(graph));
            setTimeout(() => {
                justDragged = false;
            }, 0);
        });
        instance.on('clickNode', ({ node }) => {
            if (justDragged) return;
            if (pickPathTarget(snapshot, node)) return;
            useWorkspace.getState().select(node);
        });
        instance.on('clickStage', () => useWorkspace.getState().select(null));
        // Double-click opens the table's data; sigma's default (zoom in) is suppressed.
        instance.on('doubleClickNode', (event) => {
            event.preventSigmaDefault();
            openTableTab(connectionRef.current, event.node, {
                mode: 'permanent',
            });
        });
        // The constructor has already rendered synchronously. Mark ready on the next frame rather than
        // forcing a second full render, which costs a whole extra frame on software-rasterised WebGL.
        const readyFrame = requestAnimationFrame(() => setReady(true));

        // Styles are fixed at construction; a theme switch re-creates the instance with the new colours.
        // Only the `dark` class and the colour theme matter; other class changes on <html> must not
        // rebuild the renderer.
        const root = document.documentElement;
        const themeSignature = () =>
            `${root.classList.contains('dark')}|${root.dataset.theme}`;
        let signature = themeSignature();
        const stopWatchingTheme = watchThemeChanges(() => {
            const now = themeSignature();
            if (now === signature) return;
            signature = now;
            setThemeNonce((n) => n + 1);
        });

        // Sigma only listens to window resize, so a layout change (the inspector opening or closing)
        // leaves its stage at the old size. Follow the container instead, at most once per frame. The
        // camera is untouched: its centre is in graph space, so the view keeps the same graph point
        // at the stage centre and nothing jumps. resize() also tells the overlays to re-measure.
        let lastSize: Size | null = instance.getDimensions();
        let pendingSize: Size | null = null;
        let resizeFrame = 0;
        const resizeObserver =
            typeof ResizeObserver === 'undefined'
                ? null
                : new ResizeObserver((entries) => {
                      const rect = entries[entries.length - 1]?.contentRect;
                      if (!rect) return;
                      pendingSize = changedSize(
                          lastSize,
                          rect.width,
                          rect.height,
                      );
                      if (!pendingSize || resizeFrame) return;
                      resizeFrame = requestAnimationFrame(() => {
                          resizeFrame = 0;
                          const size = pendingSize;
                          pendingSize = null;
                          if (
                              !size ||
                              !changedSize(lastSize, size.width, size.height)
                          )
                              return;
                          lastSize = size;
                          instance.resize();
                          instance.scheduleRender();
                      });
                  });
        resizeObserver?.observe(container);

        const pingAt = (table: string) => {
            if (!graph.hasNode(table)) return;
            const p = instance.graphToViewport(graph.getNodeAttributes(table));
            setPing({ x: p.x, y: p.y, id: Date.now() });
        };

        const fitNodes = (tables: string[]): Promise<void> => {
            const pts = tables
                .map((t) => instance.getNodeDisplayData(t))
                .filter((d): d is NodeDisplayData => d !== undefined);
            if (pts.length === 0) return Promise.resolve();
            const xs = pts.map((p) => p.x);
            const ys = pts.map((p) => p.y);
            const span = Math.max(
                Math.max(...xs) - Math.min(...xs),
                Math.max(...ys) - Math.min(...ys),
            );
            return camera.animate(
                {
                    x: (Math.min(...xs) + Math.max(...xs)) / 2,
                    y: (Math.min(...ys) + Math.max(...ys)) / 2,
                    ratio: Math.min(1.2, Math.max(0.08, span * 1.4)),
                },
                { duration: motionMs(450) },
            );
        };

        const unsubscribeCamera = useWorkspace.subscribe((st, prev) => {
            if (st.focus !== prev.focus) {
                if (st.focus)
                    void fitNodes([
                        ...neighborhood(
                            graph,
                            st.focus.table,
                            st.focus.depth,
                            st.showInferred,
                        ),
                    ]);
                else resetView(400);
            }
            if (st.path !== prev.path && st.path && st.path.length > 1) {
                const end = st.path[st.path.length - 1];
                void fitNodes(st.path).then(() => pingAt(end));
            }
        });

        registerUniverse({
            flyTo: (table) => {
                const d = instance.getNodeDisplayData(table);
                if (d)
                    void camera
                        .animate(
                            { x: d.x, y: d.y, ratio: 0.18 },
                            { duration: motionMs(500) },
                        )
                        .then(() => pingAt(table));
            },
            fitNodes: (tables) => void fitNodes(tables),
            fitAll: () => resetView(400),
            relayout: () => relayoutRef.current(),
        });

        setSigma(instance);

        return () => {
            cancelAnimationFrame(readyFrame);
            cameraRef.current = { graph, state: camera.getState() };
            registerUniverse(null);
            stopWatchingTheme();
            resizeObserver?.disconnect();
            cancelAnimationFrame(resizeFrame);
            unsubscribe();
            unsubscribeCamera();
            camera.removeListener('updated', onCamera);
            instance.removeListener('afterRender', onRendered);
            instance.kill();
            setSigma(null);
            setReady(false);
        };
    }, [model.graph, themeNonce]);

    return (
        <div className="absolute inset-0">
            <div
                ref={containerRef}
                className="absolute inset-0"
                data-universe-ready={ready ? 'true' : 'false'}
                aria-label={`Schema universe of ${snapshot.tables.length} tables and views`}
                role="img"
            />
            <div
                className="universe-grid-dots pointer-events-none absolute inset-0"
                aria-hidden
            />
            {sigma && (
                <ClusterLabels
                    sigma={sigma}
                    clusters={model.clusters}
                    graph={model.graph}
                />
            )}
            {sigma && <TableCards sigma={sigma} snapshot={snapshot} />}
            {ping && (
                <span
                    key={ping.id}
                    data-testid="radar-ping"
                    aria-hidden
                    className="radar-ping absolute size-7"
                    style={{ left: ping.x - 14, top: ping.y - 14 }}
                    onAnimationEnd={(e) => {
                        // The second ring (::after, started 250ms later) ends last.
                        if (e.pseudoElement === '::after') setPing(null);
                    }}
                />
            )}
            <Legend />
        </div>
    );
}
