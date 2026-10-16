import { useCallback, useEffect, useRef, useState } from 'react';
import { retryable } from '@/lib/retry-once';
import type { LayoutPositionEntry, SchemaSnapshot } from '@/types/schema';
import type { ClusterInfo } from './clusters';
import type { SchemaGraph } from './graph';
import { applyPositions, planLayout, savedMap, toLayoutEntries } from './plan';

type ModelKit = typeof import('./model-kit');
let kit: ModelKit | null = null;

/** Loads graphology and the layout code once (a failed load is retried next time); the canvas chunk shares them, so it is usually warm. */
export const loadKit = retryable(() =>
    import('./model-kit').then((loaded) => (kit = loaded)),
);

export type UniverseModel = { graph: SchemaGraph; clusters: ClusterInfo[] };
export type ModelStatus = 'idle' | 'layout' | 'ready' | 'error';

type Built = {
    snapshot: SchemaSnapshot;
    graph: SchemaGraph;
    clusters: ClusterInfo[];
};

/**
 * Builds the graph once per snapshot, applies the saved layout or computes one off-thread,
 * and reports freshly computed positions so the caller can persist them.
 * `relayout()` is a one-shot request that re-lays out the current graph in place.
 */
export function useUniverseModel(
    snapshot: SchemaSnapshot | null,
    savedEntries: LayoutPositionEntry[] | null,
    onLaidOut: (entries: LayoutPositionEntry[]) => void,
): { model: UniverseModel | null; status: ModelStatus; relayout: () => void } {
    const [model, setModel] = useState<UniverseModel | null>(null);
    const [status, setStatus] = useState<ModelStatus>('idle');
    const [, setVersion] = useState(0);

    const built = useRef<Built | null>(null);
    const pendingSnapshot = useRef<SchemaSnapshot | null>(null);
    const requestId = useRef(0);
    const onLaidOutRef = useRef(onLaidOut);
    onLaidOutRef.current = onLaidOut;

    useEffect(() => {
        if (!snapshot) {
            requestId.current++;
            built.current = null;
            pendingSnapshot.current = null;
            setModel(null);
            setStatus('idle');
            return;
        }
        if (
            built.current?.snapshot === snapshot ||
            pendingSnapshot.current === snapshot
        )
            return;
        if (savedEntries === null) return;

        const id = ++requestId.current;
        pendingSnapshot.current = snapshot;

        // A cold visit waits for the kit chunk: show the layout state, not an empty stage.
        if (!kit) setStatus('layout');
        void loadKit()
            .then((k) => {
                if (id !== requestId.current) return;
                const graph = k.buildSchemaGraph(snapshot);
                const clusters = k.assignClusters(graph);
                const plan = planLayout(
                    graph,
                    clusters,
                    savedMap(savedEntries),
                    false,
                );

                const finish = () => {
                    built.current = { snapshot, graph, clusters };
                    pendingSnapshot.current = null;
                    setModel({ graph, clusters });
                    setStatus('ready');
                };

                if (plan.complete) {
                    applyPositions(graph, plan.complete, plan.pinned);
                    finish();
                    return;
                }

                setStatus('layout');
                k.runLayout(plan.input!)
                    .then((positions) => {
                        if (id !== requestId.current) return;
                        applyPositions(graph, positions, plan.pinned);
                        finish();
                        if (graph.order > 0)
                            onLaidOutRef.current(toLayoutEntries(graph));
                    })
                    .catch(() => {
                        if (id !== requestId.current) return;
                        pendingSnapshot.current = null;
                        setStatus('error');
                    });
            })
            .catch(() => {
                if (id !== requestId.current) return;
                pendingSnapshot.current = null;
                setStatus('error');
            });
    }, [snapshot, savedEntries]);

    const relayout = useCallback(() => {
        const current = built.current;
        if (!current || !kit) return;

        const id = ++requestId.current;
        const { graph, clusters } = current;
        const plan = planLayout(
            graph,
            clusters,
            savedMap(toLayoutEntries(graph)),
            true,
        );

        setStatus('layout');
        kit.runLayout(plan.input!)
            .then((positions) => {
                if (id !== requestId.current) return;
                applyPositions(graph, positions, plan.pinned);
                setVersion((v) => v + 1);
                setStatus('ready');
                if (graph.order > 0)
                    onLaidOutRef.current(toLayoutEntries(graph));
            })
            .catch(() => {
                if (id === requestId.current) setStatus('error');
            });
    }, []);

    return { model, status, relayout };
}
