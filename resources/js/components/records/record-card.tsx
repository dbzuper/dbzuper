import {
    Handle,
    Position,
    useNodeId,
    useUpdateNodeInternals,
    type Node,
    type NodeProps,
} from '@xyflow/react';
import { ArrowRight } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cellKind } from '@/grid/cells';
import { cn } from '@/lib/utils';
import { recordFields, recordTitle, titleColumn } from '@/records/heuristics';
import { useRecords, type RecordEntry } from '@/records/records-store';
import type { RelationshipSummary } from '@/records/types';
import type { QueryCell } from '@/types/schema';
import { useWorkspace } from '@/universe/store';

export type RecordNodeData = { id: string; table: string };
export type RecordNodeType = Node<RecordNodeData, 'record'>;

const handleClass = 'pointer-events-none !size-1.5 !border-0 !opacity-0';

/** "1 record", "2 records", "10,000+ records", "? records". */
export function recordCountText(count: RelationshipSummary['count']): string {
    if (count === null) return '? records';
    const n = count.value.toLocaleString('en');
    if (count.capped) return `${n}+ records`;
    return count.value === 1 ? '1 record' : `${n} records`;
}

const countBadge = (count: RelationshipSummary['count']) =>
    count === null
        ? '?'
        : `${count.value.toLocaleString('en')}${count.capped ? '+' : ''}`;

function FieldValue({ value, type }: { value: QueryCell; type: string }) {
    const kind = cellKind(value, type);
    if (kind === 'null')
        return (
            <span data-null="true" className="text-muted-foreground/60 italic">
                NULL
            </span>
        );
    return (
        <span
            data-kind={kind}
            className={cn(
                kind === 'binary' && 'text-muted-foreground italic',
                kind === 'boolean' && 'text-[var(--universe-accent)]',
                kind === 'number' && 'tabular-nums',
            )}
        >
            {String(value)}
        </span>
    );
}

function Port({
    summary,
    onExpand,
}: {
    summary: RelationshipSummary;
    onExpand: (s: RelationshipSummary) => void;
}) {
    const cols = summary.columns.join(', ');
    const out = summary.direction === 'out';
    const disabled = out
        ? !summary.available
        : summary.count !== null && summary.count.value === 0;
    const label = out
        ? `Open ${summary.table} (${cols})`
        : `Show ${summary.table} (${cols}) — ${recordCountText(summary.count)}`;
    const title = !disabled
        ? undefined
        : out
          ? 'No related record (NULL)'
          : 'No related records';
    return (
        <button
            type="button"
            aria-label={label}
            title={title}
            disabled={disabled}
            data-inferred={summary.inferred ? 'true' : undefined}
            data-direction={summary.direction}
            onClick={() => onExpand(summary)}
            className={cn(
                'nodrag nopan relative flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors motion-reduce:transition-none',
                disabled
                    ? 'cursor-not-allowed text-muted-foreground/50'
                    : 'hover:bg-muted',
                summary.inferred && 'border border-dashed border-border',
            )}
        >
            {out && <ArrowRight aria-hidden className="size-3 shrink-0" />}
            <span className="min-w-0 flex-1 truncate font-medium">
                {summary.table}
                <span className="ml-1 font-normal text-muted-foreground">
                    {cols}
                </span>
            </span>
            {!out && (
                <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] tabular-nums">
                    {countBadge(summary.count)}
                </span>
            )}
            <Handle
                type="source"
                id={`${summary.id}:${summary.direction}`}
                position={out ? Position.Left : Position.Right}
                isConnectable={false}
                className={handleClass}
            />
        </button>
    );
}

function PortGroup({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    return (
        <div className="border-t px-1 py-1.5">
            <p className="px-2 pb-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
                {title}
            </p>
            <div className="flex flex-col">{children}</div>
        </div>
    );
}

export type RecordCardProps = {
    table: string;
    entry: RecordEntry | undefined;
    selected: boolean;
    showInferred: boolean;
    onExpand: (summary: RelationshipSummary) => void;
    onSelect: () => void;
    onRemove: () => void;
    onReload: () => void;
};

export function RecordCard({
    table,
    entry,
    selected,
    showInferred,
    onExpand,
    onSelect,
    onRemove,
    onReload,
}: RecordCardProps) {
    const source = entry?.payload ?? entry?.preview;
    const primaryKey = entry?.payload
        ? Object.keys(entry.payload.key)
        : (entry?.preview?.primaryKey ?? []);
    const columns = source?.columns ?? [];
    const values = source?.values ?? [];
    const title = source ? recordTitle(columns, values, primaryKey) : '';
    const fields = source
        ? recordFields(columns, values, primaryKey, titleColumn(columns))
        : [];
    const types = new Map(columns.map((c) => [c.name, c.type]));
    const relationships = (entry?.payload?.relationships ?? []).filter(
        (r) => showInferred || !r.inferred,
    );
    const outgoing = relationships.filter((r) => r.direction === 'out');
    const incoming = relationships.filter((r) => r.direction === 'in');
    const portKey = relationships
        .map((r) => `${r.id}:${r.direction}`)
        .join('|');

    // Ports appear after the record loads, so React Flow re-reads the handle positions.
    const updateInternals = useUpdateNodeInternals();
    // Outside a node (unit tests) there is no id.
    const nodeId = useNodeId();
    useEffect(() => {
        if (nodeId) updateInternals(nodeId);
    }, [nodeId, portKey, updateInternals]);

    const missing = entry?.status === 'missing';
    return (
        <div
            data-selected={selected ? 'true' : undefined}
            className={cn(
                'relative w-[300px] rounded-lg border bg-card text-xs text-card-foreground shadow-sm',
                selected &&
                    'border-[var(--universe-accent)] ring-2 ring-[var(--universe-accent)]',
            )}
        >
            <Handle
                type="target"
                id="target-left"
                position={Position.Left}
                isConnectable={false}
                className={handleClass}
            />
            <Handle
                type="target"
                id="target-right"
                position={Position.Right}
                isConnectable={false}
                className={handleClass}
            />
            {missing ? (
                <div className="flex items-center gap-2 px-3 py-3">
                    <span className="text-muted-foreground">
                        Record not found
                    </span>
                    <button
                        type="button"
                        onClick={onRemove}
                        className="nodrag nopan ml-auto rounded border px-2 py-0.5 hover:bg-muted"
                    >
                        Remove
                    </button>
                </div>
            ) : (
                <>
                    <button
                        type="button"
                        onClick={onSelect}
                        className="block w-full rounded-t-lg px-3 pt-2 pb-1.5 text-left focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none"
                    >
                        <span className="block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                            {table}
                        </span>
                        <span className="block truncate font-mono text-sm font-medium">
                            {title}
                        </span>
                    </button>
                    {fields.length > 0 && (
                        <dl
                            role="list"
                            aria-label="Fields"
                            className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-3 pb-2"
                        >
                            {fields.map((f) => (
                                <div key={f.name} className="contents">
                                    <dt className="truncate text-muted-foreground">
                                        {f.name}
                                    </dt>
                                    <dd className="m-0 min-w-0 truncate font-mono">
                                        <FieldValue
                                            value={f.value}
                                            type={types.get(f.name) ?? ''}
                                        />
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    )}
                    {entry?.status === 'error' && (
                        <div className="flex items-center gap-2 border-t px-3 py-2">
                            <span className="text-destructive">
                                {entry.error ?? 'Could not load the record.'}
                            </span>
                            <button
                                type="button"
                                onClick={onReload}
                                className="nodrag nopan ml-auto rounded border px-2 py-0.5 hover:bg-muted"
                            >
                                Retry
                            </button>
                        </div>
                    )}
                    {(!entry || entry.status === 'loading') && (
                        <div className="border-t px-3 py-2">
                            <div className="h-3 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                            <span className="sr-only">
                                Loading relationships
                            </span>
                        </div>
                    )}
                    {outgoing.length > 0 && (
                        <PortGroup title="Belongs to">
                            {outgoing.map((s) => (
                                <Port
                                    key={`${s.id}:${s.direction}`}
                                    summary={s}
                                    onExpand={onExpand}
                                />
                            ))}
                        </PortGroup>
                    )}
                    {incoming.length > 0 && (
                        <PortGroup title="Has many">
                            {incoming.map((s) => (
                                <Port
                                    key={`${s.id}:${s.direction}`}
                                    summary={s}
                                    onExpand={onExpand}
                                />
                            ))}
                        </PortGroup>
                    )}
                </>
            )}
        </div>
    );
}

/** The React Flow node type: binds a card to the records store. */
export function RecordNode({ data }: NodeProps<RecordNodeType>) {
    const entry = useRecords((s) => s.records[data.id]);
    const selected = useRecords((s) => s.trail.selected === data.id);
    const showInferred = useWorkspace((s) => s.showInferred);
    return (
        <RecordCard
            table={data.table}
            entry={entry}
            selected={selected}
            showInferred={showInferred}
            onExpand={(summary) =>
                useRecords.getState().expand(data.id, summary)
            }
            onSelect={() => useRecords.getState().select(data.id)}
            onRemove={() => useRecords.getState().remove(data.id)}
            onReload={() => useRecords.getState().reload(data.id)}
        />
    );
}
