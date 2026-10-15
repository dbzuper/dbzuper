import type { LayoutPositionEntry } from '@/types/schema';
import type { ClusterInfo } from './clusters';
import type { SchemaGraph } from './graph';
import type { LayoutInput, Positions } from './layout';

export type SavedPosition = { x: number; y: number; pinned: boolean };
export type LayoutPlan = {
    complete: Positions | null;
    input: LayoutInput | null;
    pinned: Set<string>;
};

export function savedMap(
    entries: LayoutPositionEntry[],
): Map<string, SavedPosition> {
    return new Map(
        entries.map((e) => [e.table, { x: e.x, y: e.y, pinned: e.pinned }]),
    );
}

export function planLayout(
    graph: SchemaGraph,
    clusters: ClusterInfo[],
    saved: Map<string, SavedPosition>,
    relayout: boolean,
): LayoutPlan {
    const nodes = graph.nodes();
    const pinned = new Set(nodes.filter((n) => saved.get(n)?.pinned));

    if (!relayout && nodes.length > 0 && nodes.every((n) => saved.has(n))) {
        const complete: Positions = {};
        for (const n of nodes) {
            const p = saved.get(n)!;
            complete[n] = { x: p.x, y: p.y };
        }
        return { complete, input: null, pinned };
    }

    const input: LayoutInput = {
        nodes: nodes.map((key) => {
            const p = saved.get(key);
            const keep = p !== undefined && (p.pinned || !relayout);
            return {
                key,
                cluster: graph.getNodeAttribute(key, 'cluster'),
                size: graph.getNodeAttribute(key, 'size'),
                ...(keep ? { fixed: { x: p.x, y: p.y } } : {}),
            };
        }),
        edges: graph.mapEdges((_edge, attrs, source, target) => ({
            source,
            target,
            weight: attrs.weight,
        })),
        clusters: clusters.map((c) => ({ id: c.id, outer: c.outer })),
    };
    return { complete: null, input, pinned };
}

export function applyPositions(
    graph: SchemaGraph,
    positions: Positions,
    pinned: Set<string>,
): void {
    graph.updateEachNodeAttributes((key, attrs) => {
        const p = positions[key];
        return p
            ? { ...attrs, x: p.x, y: p.y, pinned: pinned.has(key) }
            : attrs;
    });
}

export function toLayoutEntries(graph: SchemaGraph): LayoutPositionEntry[] {
    return graph.mapNodes((table, attrs) => ({
        table,
        x: attrs.x,
        y: attrs.y,
        pinned: attrs.pinned,
    }));
}
