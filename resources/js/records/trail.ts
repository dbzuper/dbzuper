import type { RecordKeyValues } from './types';

export const MAX_NODES = 100;
export const COLUMN_GAP = 360;
// A card is at most CARD_MAX_HEIGHT tall (its fields and ports scroll inside), so rows never overlap.
export const CARD_MAX_HEIGHT = 300;
export const ROW_GAP = 330;

export type TrailNode = { id: string; table: string; key: RecordKeyValues };
export type TrailEdge = {
    from: string;
    to: string;
    rel: string;
    dir: 'out' | 'in';
};
export type Trail = {
    nodes: TrailNode[];
    edges: TrailEdge[];
    selected: string | null;
};

export const emptyTrail = (): Trail => ({
    nodes: [],
    edges: [],
    selected: null,
});

export function stableKey(key: RecordKeyValues): string {
    return JSON.stringify(
        Object.keys(key)
            .sort()
            .map((k) => [k, key[k]]),
    );
}

export const nodeId = (table: string, key: RecordKeyValues) =>
    `${table}\u0000${stableKey(key)}`;

export function openRoot(table: string, key: RecordKeyValues): Trail {
    const id = nodeId(table, key);
    return { nodes: [{ id, table, key }], edges: [], selected: id };
}

export function addRelated(
    trail: Trail,
    fromId: string,
    rel: string,
    dir: 'out' | 'in',
    targets: { table: string; key: RecordKeyValues }[],
) {
    if (!trail.nodes.some((n) => n.id === fromId))
        return { trail, added: [] as string[], refused: 0 };
    const nodes = [...trail.nodes];
    const edges = [...trail.edges];
    const ids = new Set(nodes.map((n) => n.id));
    const added: string[] = [];
    const refusedIds = new Set<string>();
    for (const t of targets) {
        const id = nodeId(t.table, t.key);
        if (!ids.has(id)) {
            if (nodes.length >= MAX_NODES) {
                refusedIds.add(id);
                continue;
            }
            nodes.push({ id, table: t.table, key: t.key });
            ids.add(id);
            added.push(id);
        }
        if (
            !edges.some(
                (e) =>
                    e.from === fromId &&
                    e.to === id &&
                    e.rel === rel &&
                    e.dir === dir,
            )
        )
            edges.push({ from: fromId, to: id, rel, dir });
    }
    return {
        trail: { ...trail, nodes, edges },
        added,
        refused: refusedIds.size,
    };
}

export const select = (trail: Trail, id: string): Trail => ({
    ...trail,
    selected: id,
});

/** Breadth-first path from the root (nodes[0]) following edges from source to target. */
export function pathTo(
    trail: Trail,
    id: string,
): { nodes: TrailNode[]; edges: TrailEdge[] } | null {
    if (trail.nodes.length === 0) return null;
    const byId = new Map(trail.nodes.map((n) => [n.id, n]));
    const root = trail.nodes[0].id;
    if (!byId.has(id)) return null;
    const via = new Map<string, TrailEdge | null>([[root, null]]);
    const queue = [root];
    for (let head = 0; head < queue.length && !via.has(id); head++) {
        for (const e of trail.edges) {
            if (e.from === queue[head] && !via.has(e.to) && byId.has(e.to)) {
                via.set(e.to, e);
                queue.push(e.to);
            }
        }
    }
    if (!via.has(id)) return null;
    const edges: TrailEdge[] = [];
    for (let cur = id; via.get(cur); cur = via.get(cur)!.from)
        edges.unshift(via.get(cur)!);
    return {
        nodes: [root, ...edges.map((e) => e.to)].map((n) => byId.get(n)!),
        edges,
    };
}

export function placements(
    trail: Trail,
): Map<string, { x: number; y: number }> {
    const pos = new Map<string, { x: number; y: number }>();
    const taken = new Set<string>();
    const claim = (id: string, x: number, startY: number) => {
        let y = startY;
        while (taken.has(`${x}:${y}`)) y += ROW_GAP;
        pos.set(id, { x, y });
        taken.add(`${x}:${y}`);
    };
    if (trail.nodes.length === 0) return pos;
    claim(trail.nodes[0].id, 0, 0);
    // Nodes are placed in insertion order beside the first edge that introduced them.
    for (const node of trail.nodes.slice(1)) {
        const edge = trail.edges.find(
            (e) => e.to === node.id && pos.has(e.from),
        );
        const from = edge ? pos.get(edge.from)! : { x: 0, y: 0 };
        const dx = edge?.dir === 'out' ? -COLUMN_GAP : COLUMN_GAP;
        claim(node.id, from.x + dx, from.y);
    }
    return pos;
}
