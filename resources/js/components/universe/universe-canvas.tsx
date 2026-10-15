import { useEffect, useRef, useState } from 'react';
import Sigma from 'sigma';
import type { NodeDisplayData } from 'sigma/types';
import type { LayoutPositionEntry, SchemaSnapshot } from '@/types/schema';
import { registerUniverse } from '@/universe/controller';
import type {
    RelationEdgeAttributes,
    TableNodeAttributes,
} from '@/universe/graph';
import { motionMs } from '@/universe/motion';
import {
    buildDisplayState,
    edgeDisplay,
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
import { zoomLevelFor } from '@/universe/zoom';
import { ClusterLabels } from './cluster-labels';
import { Legend } from './legend';

type Props = {
    model: UniverseModel;
    snapshot: SchemaSnapshot;
    onRelayout: () => void;
    onPositionsChanged: (entries: LayoutPositionEntry[]) => void;
    onError: (error: unknown) => void;
};

export type UniverseSigma = Sigma<TableNodeAttributes, RelationEdgeAttributes>;

export function UniverseCanvas({
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
    const relayoutRef = useRef(onRelayout);
    relayoutRef.current = onRelayout;
    const positionsRef = useRef(onPositionsChanged);
    positionsRef.current = onPositionsChanged;

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const graph = model.graph;
        const colors = readUniverseColors(container);
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
                    settings: universeSettings(),
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
            onError(error);
            return;
        }

        const refreshDisplay = () => {
            display = buildDisplayState(graph, useWorkspace.getState(), colors);
            instance.refresh({ skipIndexation: true });
        };
        const unsubscribe = useWorkspace.subscribe(refreshDisplay);

        const camera = instance.getCamera();
        const onCamera = () => {
            const ratio = camera.getState().ratio;
            useWorkspace
                .getState()
                .setZoomLevel(zoomLevelFor(ratio, graph.order));
            container.parentElement?.style.setProperty(
                '--grid-size',
                `${Math.min(64, Math.max(8, 24 / ratio))}px`,
            );
        };
        camera.on('updated', onCamera);
        onCamera();

        instance.on('enterNode', ({ node }) =>
            useWorkspace.getState().hover(node),
        );
        instance.on('leaveNode', () => useWorkspace.getState().hover(null));
        instance.on('clickNode', ({ node }) =>
            useWorkspace.getState().select(node),
        );
        instance.on('clickStage', () => useWorkspace.getState().select(null));
        instance.on('doubleClickNode', (event) => {
            event.preventSigmaDefault();
            useWorkspace.getState().setFocus(event.node, 1);
        });
        // The constructor renders synchronously, so schedule one more frame to observe a render.
        instance.once('afterRender', () => setReady(true));
        instance.scheduleRender();

        // Styles are fixed at construction; a theme switch re-creates the instance with the new colours.
        const themeObserver = new MutationObserver(() =>
            setThemeNonce((n) => n + 1),
        );
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class'],
        });

        const fitNodes = (tables: string[]) => {
            const pts = tables
                .map((t) => instance.getNodeDisplayData(t))
                .filter((d): d is NodeDisplayData => d !== undefined);
            if (pts.length === 0) return;
            const xs = pts.map((p) => p.x);
            const ys = pts.map((p) => p.y);
            const span = Math.max(
                Math.max(...xs) - Math.min(...xs),
                Math.max(...ys) - Math.min(...ys),
            );
            void camera.animate(
                {
                    x: (Math.min(...xs) + Math.max(...xs)) / 2,
                    y: (Math.min(...ys) + Math.max(...ys)) / 2,
                    ratio: Math.min(1.2, Math.max(0.08, span * 1.4)),
                },
                { duration: motionMs(450) },
            );
        };

        registerUniverse({
            flyTo: (table) => {
                const d = instance.getNodeDisplayData(table);
                if (d)
                    void camera.animate(
                        { x: d.x, y: d.y, ratio: 0.18 },
                        { duration: motionMs(500) },
                    );
            },
            fitNodes,
            fitAll: () => void camera.reset({ duration: motionMs(400) }),
            relayout: () => relayoutRef.current(),
        });

        setSigma(instance);

        return () => {
            registerUniverse(null);
            themeObserver.disconnect();
            unsubscribe();
            camera.removeListener('updated', onCamera);
            instance.kill();
            setSigma(null);
            setReady(false);
        };
        // onError is stable for the lifetime of the page.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
            <Legend />
        </div>
    );
}
