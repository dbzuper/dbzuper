import type { SchemaSnapshot } from '@/types/schema';
import {
    MAX_NODES,
    nodeId,
    type Trail,
    type TrailEdge,
    type TrailNode,
} from './trail';
import type { RecordKeyValues } from './types';

const MAX_PARAM_BYTES = 16 * 1024;

function toBase64Url(text: string): string {
    let bin = '';
    for (const b of new TextEncoder().encode(text))
        bin += String.fromCharCode(b);
    return btoa(bin)
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');
}

function fromBase64Url(param: string): string {
    const bin = atob(param.replaceAll('-', '+').replaceAll('_', '/'));
    return new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(bin, (c) => c.charCodeAt(0)),
    );
}

export function encodeTrail(
    trail: Trail,
    primaryKeys: (table: string) => string[] | null,
): string {
    const index = new Map<string, number>();
    const n: [string, (string | number)[]][] = [];
    for (const node of trail.nodes) {
        const pk = primaryKeys(node.table);
        if (!pk || pk.length === 0 || pk.some((k) => !(k in node.key)))
            continue;
        index.set(node.id, n.length);
        n.push([node.table, pk.map((k) => node.key[k])]);
    }
    const e: [number, number, string, 'out' | 'in'][] = [];
    for (const edge of trail.edges) {
        const from = index.get(edge.from);
        const to = index.get(edge.to);
        if (from !== undefined && to !== undefined)
            e.push([from, to, edge.rel, edge.dir]);
    }
    const s = trail.selected !== null ? (index.get(trail.selected) ?? -1) : -1;
    return toBase64Url(JSON.stringify({ v: 1, n, e, s }));
}

const isScalar = (v: unknown): v is string | number =>
    typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
const isIndex = (v: unknown, len: number): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < len;

export function decodeTrail(
    param: string,
    snapshot: SchemaSnapshot,
): { trail: Trail; dropped: number } | null {
    try {
        if (
            param === '' ||
            param.length > MAX_PARAM_BYTES ||
            !/^[A-Za-z0-9_-]+$/.test(param)
        )
            return null;
        const data: unknown = JSON.parse(fromBase64Url(param));
        if (typeof data !== 'object' || data === null) return null;
        const { v, n, e, s } = data as Record<string, unknown>;
        if (
            v !== 1 ||
            !Array.isArray(n) ||
            !Array.isArray(e) ||
            n.length > MAX_NODES * 2 ||
            e.length > MAX_NODES * 20
        )
            return null;
        if (
            typeof s !== 'number' ||
            !Number.isInteger(s) ||
            s < -1 ||
            s >= n.length
        )
            return null;

        const pkByTable = new Map(
            snapshot.tables.map((t) => [t.name, t.primary_key]),
        );
        const kept: (TrailNode | null)[] = [];
        for (const item of n) {
            if (
                !Array.isArray(item) ||
                item.length !== 2 ||
                typeof item[0] !== 'string' ||
                !Array.isArray(item[1]) ||
                !item[1].every(isScalar)
            )
                return null;
            const pk = pkByTable.get(item[0]);
            if (!pk || pk.length === 0 || pk.length !== item[1].length) {
                kept.push(null);
                continue;
            }
            const key: RecordKeyValues = {};
            pk.forEach((k, i) => (key[k] = item[1][i] as string | number));
            kept.push({ id: nodeId(item[0], key), table: item[0], key });
        }

        const edges: TrailEdge[] = [];
        for (const item of e) {
            if (
                !Array.isArray(item) ||
                item.length !== 4 ||
                !isIndex(item[0], n.length) ||
                !isIndex(item[1], n.length) ||
                typeof item[2] !== 'string' ||
                (item[3] !== 'out' && item[3] !== 'in')
            )
                return null;
            const from = kept[item[0]];
            const to = kept[item[1]];
            if (from && to)
                edges.push({
                    from: from.id,
                    to: to.id,
                    rel: item[2],
                    dir: item[3],
                });
        }

        const nodes: TrailNode[] = [];
        const seen = new Set<string>();
        for (const node of kept) {
            if (node && !seen.has(node.id)) {
                seen.add(node.id);
                nodes.push(node);
            }
        }
        if (nodes.length > MAX_NODES) return null;
        const selectedNode = s >= 0 ? kept[s] : null;
        const selected = selectedNode
            ? selectedNode.id
            : (nodes[0]?.id ?? null);
        return {
            trail: { nodes, edges, selected },
            dropped: kept.filter((k) => k === null).length,
        };
    } catch {
        return null;
    }
}
