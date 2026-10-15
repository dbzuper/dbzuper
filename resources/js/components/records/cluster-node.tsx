import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useRecords, type ClusterState } from '@/records/records-store';
import type { RelationshipSummary } from '@/records/types';
import type { QueryCell } from '@/types/schema';
import { useWorkspace } from '@/universe/store';

export type ClusterNodeData = { key: string };
export type ClusterNodeType = Node<ClusterNodeData, 'cluster'>;

export const clusterNodeId = (key: string) => `cluster:${key}`;

type LoadedRecord = { columns: { name: string }[]; values: QueryCell[] };

/** Data-tab filter for the rows of a cluster: the child columns equal the parent row's referenced values. */
export const clusterFilters = (
    cluster: ClusterState,
    parent: LoadedRecord | undefined,
) => relationFilters(cluster.summary, parent);

/**
 * Data-tab filter for the rows a relationship port of a loaded record leads to, in either direction:
 * the target's relationship columns equal this record's values. Null while a value is unknown or NULL.
 */
export function relationFilters(
    summary: RelationshipSummary,
    record: LoadedRecord | undefined,
): { column: string; value: string }[] | null {
    if (!record) return null;
    const filterColumns =
        summary.direction === 'in' ? summary.columns : summary.other_columns;
    const recordColumns =
        summary.direction === 'in' ? summary.other_columns : summary.columns;
    const filters: { column: string; value: string }[] = [];
    for (let i = 0; i < filterColumns.length; i++) {
        const at = record.columns.findIndex((c) => c.name === recordColumns[i]);
        const value = at < 0 ? null : record.values[at];
        if (value === null || value === undefined) return null;
        filters.push({ column: filterColumns[i], value: String(value) });
    }
    return filters;
}

export function ClusterNode({ data }: NodeProps<ClusterNodeType>) {
    const cluster = useRecords((s) => s.clusters[data.key]);
    const parent = useRecords((s) => s.records[cluster?.from ?? '']?.payload);
    if (!cluster) return null;
    const filters = clusterFilters(cluster, parent);
    const label =
        cluster.remaining === null || cluster.remaining <= 0
            ? `More ${cluster.table}`
            : `+${cluster.remaining.toLocaleString('en')} more ${cluster.table}`;
    const side =
        cluster.summary.direction === 'in' ? Position.Left : Position.Right;
    return (
        <div className="w-[220px] rounded-lg border border-dashed bg-card px-3 py-2 text-xs text-card-foreground">
            <Handle
                type="target"
                id="target"
                position={side}
                isConnectable={false}
                className="pointer-events-none !size-1.5 !border-0 !opacity-0"
            />
            <p className="mb-2 font-medium">{label}</p>
            <div className="flex flex-wrap gap-1.5">
                <button
                    type="button"
                    aria-label={`Add next 25 ${cluster.table}`}
                    disabled={cluster.loading}
                    onClick={() => useRecords.getState().more(data.key)}
                    className="nodrag nopan rounded border px-2 py-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none disabled:opacity-50"
                >
                    Add next 25
                </button>
                <button
                    type="button"
                    disabled={filters === null}
                    title={
                        filters === null
                            ? 'The parent record has not loaded yet'
                            : undefined
                    }
                    onClick={() => {
                        if (!filters) return;
                        const ws = useWorkspace.getState();
                        ws.openDataFilter(cluster.table, filters);
                        ws.select(cluster.table, 'data');
                    }}
                    className="nodrag nopan rounded border px-2 py-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none disabled:opacity-50"
                >
                    Open in Data tab
                </button>
            </div>
        </div>
    );
}
