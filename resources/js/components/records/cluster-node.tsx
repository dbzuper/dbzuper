import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useRecords, type ClusterState } from '@/records/records-store';
import type { QueryCell } from '@/types/schema';
import { useWorkspace } from '@/universe/store';

export type ClusterNodeData = { key: string };
export type ClusterNodeType = Node<ClusterNodeData, 'cluster'>;

export const clusterNodeId = (key: string) => `cluster:${key}`;

/** Data-tab filter for the rows of a cluster: the child columns equal the parent row's referenced values. */
export function clusterFilters(
    cluster: ClusterState,
    parent: { columns: { name: string }[]; values: QueryCell[] } | undefined,
): { column: string; value: string }[] | null {
    if (!parent) return null;
    const { summary } = cluster;
    const filterColumns =
        summary.direction === 'in' ? summary.columns : summary.other_columns;
    const parentColumns =
        summary.direction === 'in' ? summary.other_columns : summary.columns;
    const filters: { column: string; value: string }[] = [];
    for (let i = 0; i < filterColumns.length; i++) {
        const at = parent.columns.findIndex((c) => c.name === parentColumns[i]);
        const value = at < 0 ? null : parent.values[at];
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
        cluster.remaining === null
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
                    className="nodrag nopan rounded border px-2 py-1 hover:bg-muted disabled:opacity-50"
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
                    className="nodrag nopan rounded border px-2 py-1 hover:bg-muted disabled:opacity-50"
                >
                    Open in Data tab
                </button>
            </div>
        </div>
    );
}
