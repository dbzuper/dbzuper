import Graph from 'graphology';
import type { SchemaSnapshot } from '@/types/schema';

export type TableNodeAttributes = {
    label: string;
    kind: 'table' | 'view';
    rows: number | null;
    columns: number;
    x: number;
    y: number;
    size: number;
    color: string;
    cluster: string;
    pinned: boolean;
};

export type RelationEdgeAttributes = {
    relationships: string[];
    inferred: boolean;
    weight: number;
    size: number;
};

export type SchemaGraph = Graph<TableNodeAttributes, RelationEdgeAttributes>;

/** Smallest node radius in screen pixels: big enough to see, hit and carry a label. */
export const MIN_NODE_SIZE = 6;

export function nodeSizeFor(rows: number | null): number {
    if (rows === null || rows < 0) return MIN_NODE_SIZE;
    return Math.min(20, Math.max(MIN_NODE_SIZE, 4 + 3 * Math.log10(1 + rows)));
}

export function edgeSizeFor(weight: number): number {
    return Math.min(4, 0.6 + 0.5 * weight);
}

export function edgeKey(a: string, b: string): string {
    return a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export function buildSchemaGraph(snapshot: SchemaSnapshot): SchemaGraph {
    const graph: SchemaGraph = new Graph<
        TableNodeAttributes,
        RelationEdgeAttributes
    >({ type: 'undirected', multi: false, allowSelfLoops: true });

    for (const table of snapshot.tables) {
        graph.addNode(table.name, {
            label: table.name,
            kind: table.kind,
            rows: table.row_count.count,
            columns: table.columns.length,
            x: 0,
            y: 0,
            size: nodeSizeFor(table.row_count.count),
            color: '#8a8f98',
            cluster: '',
            pinned: false,
        });
    }

    for (const rel of snapshot.relationships) {
        if (!graph.hasNode(rel.from_table) || !graph.hasNode(rel.to_table))
            continue;
        const key = edgeKey(rel.from_table, rel.to_table);
        if (graph.hasEdge(key)) {
            graph.updateEdgeAttributes(key, (a) => {
                const weight = a.weight + 1;
                return {
                    ...a,
                    relationships: [...a.relationships, rel.id],
                    inferred: a.inferred && rel.inferred,
                    weight,
                    size: edgeSizeFor(weight),
                };
            });
        } else {
            graph.addUndirectedEdgeWithKey(key, rel.from_table, rel.to_table, {
                relationships: [rel.id],
                inferred: rel.inferred,
                weight: 1,
                size: edgeSizeFor(1),
            });
        }
    }

    return graph;
}
