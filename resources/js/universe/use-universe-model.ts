import { useCallback, useEffect, useState } from 'react';
import type { LayoutPositionEntry, SchemaSnapshot } from '@/types/schema';
import { assignClusters, type ClusterInfo } from './clusters';
import { buildSchemaGraph, type SchemaGraph } from './graph';
import { applyPositions, planLayout, savedMap, toLayoutEntries } from './plan';
import { runLayout } from './run-layout';

export type UniverseModel = { graph: SchemaGraph; clusters: ClusterInfo[] };
export type ModelStatus = 'idle' | 'layout' | 'ready' | 'error';

/**
 * Builds the graph for a snapshot, applies the saved layout or computes one off-thread,
 * and reports freshly computed positions so the caller can persist them.
 */
export function useUniverseModel(
    snapshot: SchemaSnapshot | null,
    savedEntries: LayoutPositionEntry[] | null,
    onLaidOut: (entries: LayoutPositionEntry[]) => void,
): { model: UniverseModel | null; status: ModelStatus; relayout: () => void } {
    const [model, setModel] = useState<UniverseModel | null>(null);
    const [status, setStatus] = useState<ModelStatus>('idle');
    const [relayoutNonce, setRelayoutNonce] = useState(0);

    useEffect(() => {
        if (!snapshot || savedEntries === null) return;
        let cancelled = false;

        const graph =
            model && relayoutNonce > 0
                ? model.graph
                : buildSchemaGraph(snapshot);
        const clusters =
            model && relayoutNonce > 0 ? model.clusters : assignClusters(graph);
        const saved =
            relayoutNonce > 0
                ? savedMap(toLayoutEntries(graph))
                : savedMap(savedEntries);
        const plan = planLayout(graph, clusters, saved, relayoutNonce > 0);

        if (plan.complete) {
            applyPositions(graph, plan.complete, plan.pinned);
            setModel({ graph, clusters });
            setStatus('ready');
            return;
        }

        setStatus('layout');
        runLayout(plan.input!)
            .then((positions) => {
                if (cancelled) return;
                applyPositions(graph, positions, plan.pinned);
                setModel({ graph, clusters });
                setStatus('ready');
                onLaidOut(toLayoutEntries(graph));
            })
            .catch(() => {
                if (!cancelled) setStatus('error');
            });

        return () => {
            cancelled = true;
        };
        // `model` is intentionally read but not a dependency: a relayout reuses the current graph.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [snapshot, savedEntries, relayoutNonce]);

    const relayout = useCallback(() => setRelayoutNonce((n) => n + 1), []);

    return { model, status, relayout };
}
