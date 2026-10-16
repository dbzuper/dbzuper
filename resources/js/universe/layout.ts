import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

export type LayoutNode = {
    key: string;
    cluster: string;
    size: number;
    fixed?: { x: number; y: number };
};
export type LayoutInput = {
    nodes: LayoutNode[];
    edges: { source: string; target: string; weight: number }[];
    clusters: { id: string; outer: boolean }[];
};
export type Position = { x: number; y: number };
export type Positions = Record<string, Position>;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function iterationsFor(n: number): number {
    if (n <= 200) return 300;
    if (n <= 1000) return 150;
    return 60;
}

export function seedPositions(input: LayoutInput): Positions {
    const inner = input.clusters.filter((c) => !c.outer);
    const radius = inner.length > 1 ? 40 * Math.sqrt(input.nodes.length) : 0;
    const centers = new Map<string, Position>();
    inner.forEach((c, i) => {
        const angle = (2 * Math.PI * i) / inner.length;
        centers.set(c.id, {
            x: radius * Math.cos(angle),
            y: radius * Math.sin(angle),
        });
    });

    const counters = new Map<string, number>();
    const out: Positions = {};
    for (const node of input.nodes) {
        if (node.fixed) {
            out[node.key] = { ...node.fixed };
            continue;
        }
        const center = centers.get(node.cluster) ?? { x: 0, y: 0 };
        const j = counters.get(node.cluster) ?? 0;
        counters.set(node.cluster, j + 1);
        const r = 8 * Math.sqrt(j + 1);
        out[node.key] = {
            x: center.x + r * Math.cos(j * GOLDEN_ANGLE),
            y: center.y + r * Math.sin(j * GOLDEN_ANGLE),
        };
    }
    return out;
}

export function computeLayout(
    input: LayoutInput,
    iterations = iterationsFor(input.nodes.length),
): Positions {
    const seeds = seedPositions(input);
    const outer = new Set(
        input.clusters.filter((c) => c.outer).map((c) => c.id),
    );

    const graph = new Graph({ type: 'undirected', allowSelfLoops: false });
    for (const node of input.nodes) {
        if (outer.has(node.cluster) && !node.fixed) continue;
        graph.addNode(node.key, {
            ...seeds[node.key],
            size: node.size,
            fixed: Boolean(node.fixed),
        });
    }
    for (const edge of input.edges) {
        if (
            edge.source === edge.target ||
            !graph.hasNode(edge.source) ||
            !graph.hasNode(edge.target)
        )
            continue;
        graph.mergeEdge(edge.source, edge.target, { weight: edge.weight });
    }

    if (graph.order > 1 && graph.size > 0 && iterations > 0) {
        forceAtlas2.assign(graph, {
            iterations,
            getEdgeWeight: 'weight',
            settings: {
                ...forceAtlas2.inferSettings(graph),
                barnesHutOptimize: graph.order > 400,
                gravity: 1,
                scalingRatio: 10,
            },
        });
    }

    const out: Positions = {};
    graph.forEachNode((key, attrs) => {
        out[key] = { x: attrs.x as number, y: attrs.y as number };
    });

    const ring = input.nodes
        .filter((n) => outer.has(n.cluster) && !n.fixed)
        .map((n) => n.key)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (ring.length > 0) placeOuter(ring, out, typicalSpacing(graph, out));

    return out;
}

/** Gap, in typical edge lengths, between the core and the first ring of unrelated tables. */
const RING_GAP = 1.5;

/** Outer tables this few sit in a column beside the core rather than on a ring around it. */
export const OUTER_COLUMN_MAX = 5;

/** Median edge length of the laid-out core (a fallback when it has no edges). */
function typicalSpacing(graph: Graph, out: Positions): number {
    const lengths: number[] = [];
    graph.forEachEdge((_e, _a, source, target) => {
        const p = out[source];
        const q = out[target];
        lengths.push(Math.hypot(p.x - q.x, p.y - q.y));
    });
    lengths.sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];
    return median !== undefined && median > 0 ? median : 30;
}

/**
 * Places unrelated tables just outside the core, about one typical edge length away, so the camera's
 * fit-to-graph does not shrink the core. A handful go in a column on the left; more go on rings.
 */
function placeOuter(ring: string[], out: Positions, spacing: number): void {
    const pts = Object.values(out);
    const cx = pts.length ? pts.reduce((s, p) => s + p.x, 0) / pts.length : 0;
    const cy = pts.length ? pts.reduce((s, p) => s + p.y, 0) / pts.length : 0;
    const rmax = pts.reduce(
        (m, p) => Math.max(m, Math.hypot(p.x - cx, p.y - cy)),
        0,
    );

    if (ring.length <= OUTER_COLUMN_MAX) {
        // On the left, one spacing from the core: labels are drawn to the right of their node, so
        // they run into the gap instead of off the edge of the fitted view.
        const minX = pts.reduce((m, p) => Math.min(m, p.x), cx);
        const x = minX - spacing;
        ring.forEach((key, i) => {
            out[key] = { x, y: cy + (i - (ring.length - 1) / 2) * spacing };
        });
        return;
    }

    // Concentric rings, each filled with neighbours about one spacing apart, then the next ring out.
    let placed = 0;
    for (let k = 0; placed < ring.length; k++) {
        const R = rmax + (RING_GAP + k) * spacing;
        const capacity = Math.max(1, Math.floor((2 * Math.PI * R) / spacing));
        const count = Math.min(capacity, ring.length - placed);
        const offset = k % 2 === 0 ? 0 : Math.PI / count;
        for (let i = 0; i < count; i++) {
            const angle = offset + (2 * Math.PI * i) / count;
            out[ring[placed + i]] = {
                x: cx + R * Math.cos(angle),
                y: cy + R * Math.sin(angle),
            };
        }
        placed += count;
    }
}
