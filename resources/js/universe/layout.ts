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
    if (ring.length > 0) {
        const pts = Object.values(out);
        const cx = pts.length
            ? pts.reduce((s, p) => s + p.x, 0) / pts.length
            : 0;
        const cy = pts.length
            ? pts.reduce((s, p) => s + p.y, 0) / pts.length
            : 0;
        const rmax = pts.reduce(
            (m, p) => Math.max(m, Math.hypot(p.x - cx, p.y - cy)),
            0,
        );
        const R = rmax * 1.25 + 30;
        ring.forEach((key, i) => {
            const angle = (2 * Math.PI * i) / ring.length;
            out[key] = {
                x: cx + R * Math.cos(angle),
                y: cy + R * Math.sin(angle),
            };
        });
    }

    return out;
}
