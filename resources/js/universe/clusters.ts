import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import type { SchemaGraph } from './graph';

export const CLUSTER_PALETTE = [
    '#6f9fc8',
    '#7fb08a',
    '#c49a62',
    '#a985b3',
    '#5fb0a8',
    '#c48686',
    '#8e93cc',
    '#a3a65f',
] as const;
export const ISOLATED_COLOR = '#8a8f98';
export const ISOLATED_CLUSTER = 'isolated';

export type ClusterInfo = {
    id: string;
    label: string;
    color: string;
    members: string[];
    outer: boolean;
};

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function prefixOf(name: string): string | null {
    const i = name.indexOf('_');
    return i >= 2 ? name.slice(0, i).toLowerCase() : null;
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function degree(graph: SchemaGraph, node: string): number {
    let d = 0;
    graph.forEachNeighbor(node, (neighbor) => {
        if (neighbor !== node) d++;
    });
    return d;
}

export function clusterLabel(members: string[], graph: SchemaGraph): string {
    if (members.length >= 2) {
        const counts = new Map<string, number>();
        for (const m of members) {
            const p = prefixOf(m);
            if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
        }
        let best: [string, number] | null = null;
        for (const entry of [...counts.entries()].sort(([a], [b]) =>
            byName(a, b),
        )) {
            if (!best || entry[1] > best[1]) best = entry;
        }
        if (best && best[1] / members.length >= 0.6) return `${best[0]}_*`;
    }
    return [...members].sort(
        (a, b) => degree(graph, b) - degree(graph, a) || byName(a, b),
    )[0];
}

export function assignClusters(graph: SchemaGraph): ClusterInfo[] {
    const nodes = [...graph.nodes()].sort(byName);
    const connected = nodes.filter((n) => degree(graph, n) > 0);
    const isolated = nodes.filter((n) => degree(graph, n) === 0);

    const communityGroups: string[][] = [];
    if (connected.length > 0) {
        const g = new Graph({ type: 'undirected' });
        for (const n of connected) g.addNode(n);
        graph.forEachEdge((_edge, attrs, source, target) => {
            if (source !== target)
                g.mergeEdge(source, target, { weight: attrs.weight });
        });
        const communities = louvain(g, {
            rng: mulberry32(42),
            getEdgeWeight: 'weight',
        });
        const grouped = new Map<number, string[]>();
        for (const n of connected)
            grouped.set(communities[n], [
                ...(grouped.get(communities[n]) ?? []),
                n,
            ]);
        communityGroups.push(...grouped.values());
    }
    communityGroups.sort((a, b) => b.length - a.length || byName(a[0], b[0]));

    const byPrefix = new Map<string, string[]>();
    const loners: string[] = [];
    for (const n of isolated) {
        const p = prefixOf(n);
        if (p) byPrefix.set(p, [...(byPrefix.get(p) ?? []), n]);
        else loners.push(n);
    }
    const prefixGroups: string[][] = [];
    for (const [, members] of [...byPrefix.entries()].sort(([a], [b]) =>
        byName(a, b),
    )) {
        if (members.length >= 2) prefixGroups.push(members);
        else loners.push(...members);
    }
    prefixGroups.sort((a, b) => b.length - a.length || byName(a[0], b[0]));

    const clusters: ClusterInfo[] = [...communityGroups, ...prefixGroups].map(
        (members, i) => ({
            id: `c${i}`,
            label: clusterLabel(members, graph),
            color: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length],
            members,
            outer: false,
        }),
    );
    if (loners.length > 0) {
        clusters.push({
            id: ISOLATED_CLUSTER,
            label: 'Unrelated tables',
            color: ISOLATED_COLOR,
            members: loners.sort(byName),
            outer: true,
        });
    }

    for (const cluster of clusters) {
        for (const member of cluster.members)
            graph.mergeNodeAttributes(member, {
                cluster: cluster.id,
                color: cluster.color,
            });
    }

    return clusters;
}
