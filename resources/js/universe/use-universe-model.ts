import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutPositionEntry, SchemaSnapshot } from '@/types/schema';
import { assignClusters, type ClusterInfo } from './clusters';
import { buildSchemaGraph, type SchemaGraph } from './graph';
import { applyPositions, planLayout, savedMap, toLayoutEntries } from './plan';
import { runLayout } from './run-layout';

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

        const graph = buildSchemaGraph(snapshot);
        const clusters = assignClusters(graph);
        const plan = planLayout(graph, clusters, savedMap(savedEntries), false);

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
        runLayout(plan.input!)
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
    }, [snapshot, savedEntries]);

    const relayout = useCallback(() => {
        const current = built.current;
        if (!current) return;

        const id = ++requestId.current;
        const { graph, clusters } = current;
        const plan = planLayout(
            graph,
            clusters,
            savedMap(toLayoutEntries(graph)),
            true,
        );

        setStatus('layout');
        runLayout(plan.input!)
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
