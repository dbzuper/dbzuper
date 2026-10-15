import '@xyflow/react/dist/style.css';
import {
    applyNodeChanges,
    Background,
    BackgroundVariant,
    Controls,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    type Edge,
    type Node,
    type NodeChange,
    type NodeTypes,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLUMN_GAP, pathTo, placements, ROW_GAP } from '@/records/trail';
import { useRecords } from '@/records/records-store';
import type { ConnectionSummary } from '@/types/connection';
import type { SchemaSnapshot } from '@/types/schema';
import { ClusterNode, clusterNodeId } from './cluster-node';
import { RecordNode } from './record-card';
import { RecordsBreadcrumb } from './records-breadcrumb';

const nodeTypes: NodeTypes = { record: RecordNode, cluster: ClusterNode };

type Point = { x: number; y: number };

// Trail ids contain quotes and NUL, which React Flow interpolates into CSS selectors
// (`[data-id="…"]`), so every flow id is a hex encoding of the logical id.
const encoder = new TextEncoder();
export const flowId = (id: string) =>
    Array.from(encoder.encode(id), (b) => b.toString(16).padStart(2, '0')).join(
        '',
    );

const prefersReducedMotion = () =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const EMPTY_TEXT =
    'Open a record from the Data tab, a result row, a foreign-key cell, or the command palette (users 42).';

function Explorer({
    connection,
    snapshot,
}: {
    connection: ConnectionSummary;
    snapshot: SchemaSnapshot;
}) {
    const trail = useRecords((s) => s.trail);
    const clusters = useRecords((s) => s.clusters);
    const notice = useRecords((s) => s.notice);
    const epoch = useRecords((s) => s.epoch);
    const { fitView } = useReactFlow();

    // Positions the user dragged live in memory only and are dropped whenever the trail is replaced.
    const [dragged, setDragged] = useState<{
        epoch: number;
        at: Record<string, Point>;
    }>({
        epoch,
        at: {},
    });
    const draggedAt = dragged.epoch === epoch ? dragged.at : undefined;

    const desired = useMemo(() => {
        const base = placements(trail);
        const pos = (id: string): Point =>
            draggedAt?.[flowId(id)] ?? base.get(id) ?? { x: 0, y: 0 };
        const nodes: Node[] = trail.nodes.map((n) => ({
            id: flowId(n.id),
            type: 'record',
            position: pos(n.id),
            data: { id: n.id, table: n.table, key: n.key },
            selected: n.id === trail.selected,
        }));
        // A cluster sits below everything already in its column, beside the card it grew from.
        const used = new Set(
            nodes.map((n) => `${n.position.x}:${n.position.y}`),
        );
        for (const [key, c] of Object.entries(clusters)) {
            const from = pos(c.from);
            const x =
                from.x +
                (c.summary.direction === 'in' ? COLUMN_GAP : -COLUMN_GAP);
            let y = Math.max(
                from.y,
                ...nodes
                    .filter((n) => n.position.x === x)
                    .map((n) => n.position.y + ROW_GAP),
            );
            while (used.has(`${x}:${y}`)) y += ROW_GAP;
            used.add(`${x}:${y}`);
            nodes.push({
                id: flowId(clusterNodeId(key)),
                type: 'cluster',
                position: draggedAt?.[flowId(clusterNodeId(key))] ?? { x, y },
                data: { key },
                draggable: true,
            });
        }
        return nodes;
    }, [trail, clusters, draggedAt]);

    // Controlled nodes: keep the measured sizes and in-progress drags that React Flow reports.
    const [nodes, setNodes] = useState<Node[]>([]);
    useEffect(() => {
        setNodes((prev) => {
            const byId = new Map(prev.map((n) => [n.id, n]));
            return desired.map((n) => {
                const old = byId.get(n.id);
                return old ? { ...n, measured: old.measured } : n;
            });
        });
    }, [desired]);

    // Only drags and measuring are applied: selection lives in the store and cards are never
    // removed from the canvas (that is what the card's Remove button is for).
    const onNodesChange = useCallback(
        (changes: NodeChange[]) =>
            setNodes((prev) =>
                applyNodeChanges(
                    changes.filter(
                        (c) => c.type === 'position' || c.type === 'dimensions',
                    ),
                    prev,
                ),
            ),
        [],
    );

    // Dashing follows the schema (is the relationship inferred?), not what happens to be loaded.
    const inferredIds = useMemo(
        () =>
            new Set(
                snapshot.relationships
                    .filter((r) => r.inferred)
                    .map((r) => r.id),
            ),
        [snapshot],
    );

    const edges = useMemo(() => {
        const onPath = new Set(
            (trail.selected ? pathTo(trail, trail.selected)?.edges : null)?.map(
                (e) => `${e.from}>${e.to}|${e.rel}|${e.dir}`,
            ) ?? [],
        );
        const style = (selected: boolean, inferred: boolean) => ({
            stroke: selected ? 'var(--universe-accent)' : undefined,
            strokeWidth: selected ? 2 : undefined,
            strokeDasharray: inferred ? '6 4' : undefined,
        });
        const out: Edge[] = trail.edges.map((e) => {
            const id = `${e.from}>${e.to}|${e.rel}|${e.dir}`;
            const inferred = inferredIds.has(e.rel);
            return {
                id: flowId(id),
                type: 'smoothstep',
                source: flowId(e.from),
                target: flowId(e.to),
                sourceHandle: `${e.rel}:${e.dir}`,
                targetHandle: e.dir === 'in' ? 'target-left' : 'target-right',
                selectable: false,
                focusable: false,
                style: style(onPath.has(id), inferred),
            };
        });
        for (const [key, c] of Object.entries(clusters)) {
            out.push({
                id: flowId(`edge:${key}`),
                type: 'smoothstep',
                source: flowId(c.from),
                target: flowId(clusterNodeId(key)),
                sourceHandle: `${c.summary.id}:${c.summary.direction}`,
                targetHandle: 'target',
                selectable: false,
                focusable: false,
                style: {
                    ...style(false, c.summary.inferred),
                    strokeDasharray: '2 4',
                },
            });
        }
        return out;
    }, [trail, clusters, inferredIds]);

    // Fit the whole trail after an open; after an expansion pan to take in the new cards.
    const pending = useRef<{ ids: string[]; all: boolean } | null>(null);
    const seen = useRef<{ epoch: number; ids: Set<string> }>({
        epoch: -1,
        ids: new Set(),
    });
    useEffect(() => {
        const ids = trail.nodes.map((n) => n.id);
        const prev = seen.current;
        if (prev.epoch !== epoch) {
            pending.current = ids.length
                ? { ids: ids.map(flowId), all: true }
                : null;
        } else {
            const added = ids.filter((id) => !prev.ids.has(id));
            if (added.length > 0) {
                const origin = trail.edges.find((e) => e.to === added[0])?.from;
                pending.current = {
                    ids: (origin ? [origin, ...added] : added).map(flowId),
                    all: false,
                };
            }
        }
        seen.current = { epoch, ids: new Set(ids) };
    }, [trail, epoch]);

    useEffect(() => {
        const job = pending.current;
        if (!job) return;
        const have = new Set(nodes.map((n) => n.id));
        if (!job.ids.every((id) => have.has(id))) return;
        pending.current = null;
        void fitView({
            padding: 0.2,
            maxZoom: 1,
            duration: prefersReducedMotion() ? 0 : 200,
            ...(job.all ? {} : { nodes: job.ids.map((id) => ({ id })) }),
        });
    }, [nodes, fitView]);

    return (
        <section
            aria-label="Record explorer"
            className="absolute inset-0 flex flex-col"
        >
            <RecordsBreadcrumb connection={connection} snapshot={snapshot} />
            <div className="relative min-h-0 flex-1">
                {trail.nodes.length === 0 ? (
                    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                        {EMPTY_TEXT}
                    </div>
                ) : (
                    <ReactFlow
                        className="records-flow"
                        nodes={nodes}
                        edges={edges}
                        nodeTypes={nodeTypes}
                        onNodesChange={onNodesChange}
                        onNodeDragStop={(_, node) =>
                            setDragged((d) => ({
                                epoch,
                                at: {
                                    ...(d.epoch === epoch ? d.at : {}),
                                    [node.id]: node.position,
                                },
                            }))
                        }
                        onNodeClick={(_, node) => {
                            if (node.type === 'record')
                                useRecords
                                    .getState()
                                    .select((node.data as { id: string }).id);
                        }}
                        nodesConnectable={false}
                        // Every interactive part of a card is a real button (the header selects), so the
                        // card wrapper itself stays out of the tab order and React Flow's own
                        // keyboard selection, which would bypass the store, is off.
                        nodesFocusable={false}
                        edgesFocusable={false}
                        deleteKeyCode={null}
                        selectionKeyCode={null}
                        multiSelectionKeyCode={null}
                        elementsSelectable
                        minZoom={0.1}
                        proOptions={{ hideAttribution: true }}
                    >
                        <Background variant={BackgroundVariant.Dots} />
                        <Controls showInteractive={false} />
                    </ReactFlow>
                )}
                {notice && (
                    <div
                        role="status"
                        className="absolute inset-x-0 top-0 z-10 m-3 flex items-center gap-3 rounded-md border bg-background px-3 py-2 text-xs shadow-sm"
                    >
                        <span>{notice}</span>
                        <button
                            type="button"
                            onClick={() =>
                                useRecords.getState().dismissNotice()
                            }
                            className="ml-auto rounded border px-2 py-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none"
                        >
                            Dismiss
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
}

export default function RecordsView({
    connection,
    snapshot,
}: {
    connection: ConnectionSummary;
    snapshot: SchemaSnapshot;
}) {
    return (
        <ReactFlowProvider key={connection.id}>
            <Explorer connection={connection} snapshot={snapshot} />
        </ReactFlowProvider>
    );
}
