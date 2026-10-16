import {
    Handle,
    Position,
    useNodeId,
    useReactFlow,
    useUpdateNodeInternals,
    type Node,
    type NodeProps,
} from '@xyflow/react';
import { ArrowRight } from 'lucide-react';
import {
    createContext,
    useContext,
    useEffect,
    useRef,
    type ReactNode,
} from 'react';
import { cellKind } from '@/grid/cells';
import { cn } from '@/lib/utils';
import { recordFields, recordTitle, titleColumn } from '@/records/heuristics';
import { explorableTable } from '@/records/open-record';
import { CARD_MAX_HEIGHT } from '@/records/trail';
import { useRecords, type RecordEntry } from '@/records/records-store';
import type { RecordKeyValues, RelationshipSummary } from '@/records/types';
import type { QueryCell, SchemaSnapshot } from '@/types/schema';
import { useWorkspace } from '@/universe/store';
import { relationFilters } from './cluster-node';

type DataFilters = { column: string; value: string }[];

/** The schema the explorer runs against; cards use it to tell which related tables can be explored. */
export const RecordsSnapshotContext = createContext<SchemaSnapshot | null>(
    null,
);

export type RecordNodeData = {
    id: string;
    table: string;
    key: RecordKeyValues;
};
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
    dataTab,
    onOpenInData,
}: {
    summary: RelationshipSummary;
    onExpand: (s: RelationshipSummary) => void;
    /** Set when the target table cannot be explored: the port opens these rows in the Data tab instead. */
    dataTab: { filters: DataFilters | null } | null;
    onOpenInData: (table: string, filters: DataFilters) => void;
}) {
    const cols = summary.columns.join(', ');
    const out = summary.direction === 'out';
    const empty = out
        ? !summary.available
        : summary.count !== null && summary.count.value === 0;
    const disabled = empty || (dataTab !== null && dataTab.filters === null);
    const label = dataTab
        ? `Open ${summary.table} (${cols}) in Data tab`
        : out
          ? `Open ${summary.table} (${cols})`
          : `Show ${summary.table} (${cols}) ${recordCountText(summary.count)}`;
    const title = !disabled
        ? dataTab
            ? `${summary.table} cannot be explored as records`
            : undefined
        : !empty
          ? 'The related values are unknown'
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
            onClick={() => {
                if (!dataTab) onExpand(summary);
                else if (dataTab.filters)
                    onOpenInData(summary.table, dataTab.filters);
            }}
            className={cn(
                'nodrag nopan relative flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors motion-reduce:transition-none',
                'focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none',
                disabled
                    ? 'cursor-not-allowed text-muted-foreground/50'
                    : 'hover:bg-muted',
                summary.inferred && 'border border-dashed border-border',
            )}
        >
            {out && <ArrowRight aria-hidden className="size-3 shrink-0" />}
            <span className="min-w-0 flex-1 truncate font-medium">
                {summary.table}{' '}
                <span className="font-normal text-muted-foreground">
                    ({cols})
                </span>
            </span>
            {/* Text nodes between flex items are not drawn, but they keep the visible text in the same
                word order as the accessible name ("orders (user_id) 3 records"). */}
            {!out && (
                <>
                    {' '}
                    <span
                        aria-hidden
                        className="shrink-0 rounded bg-muted px-1.5 text-[10px] tabular-nums"
                    >
                        {countBadge(summary.count)}
                    </span>
                </>
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
    recordKey: RecordKeyValues;
    /** Handle ids (`rel:dir`) that trail edges or clusters leave from, whether or not their port is drawn. */
    edgeHandles?: string[];
    entry: RecordEntry | undefined;
    selected: boolean;
    showInferred: boolean;
    onExpand: (summary: RelationshipSummary) => void;
    onSelect: () => void;
    onRemove: () => void;
    onReload: () => void;
    /** Whether a related table can be explored as records; other ports open the Data tab. */
    isExplorable?: (table: string) => boolean;
    onOpenInData?: (table: string, filters: DataFilters) => void;
};

const PAN_MS = 200;
const panDuration = () =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : PAN_MS;

const always = () => true;
const nothing = () => undefined;

const formatKey = (key: RecordKeyValues) =>
    Object.entries(key)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');

export function RecordCard({
    table,
    recordKey,
    edgeHandles = [],
    entry,
    selected,
    showInferred,
    onExpand,
    onSelect,
    onRemove,
    onReload,
    isExplorable = always,
    onOpenInData = nothing,
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
    const portIds = relationships.map((r) => `${r.id}:${r.direction}`);
    // Edges attach to port handles. A port can be hidden (inferred off) or not drawn yet
    // (loading, failed, restored trail), so a quiet handle backs every edge without one.
    const extraHandles = edgeHandles.filter((h) => !portIds.includes(h));
    const portKey = [...portIds, '#', ...extraHandles].join('|');

    // Ports appear after the record loads, so React Flow re-reads the handle positions.
    const updateInternals = useUpdateNodeInternals();
    // Outside a node (unit tests) there is no id.
    const nodeId = useNodeId();
    useEffect(() => {
        if (nodeId) updateInternals(nodeId);
    }, [nodeId, portKey, updateInternals]);

    // Tabbing to a control inside a card pans the canvas to it. Focus that follows a pointer press
    // is left alone: the user is already looking at the card.
    const { setCenter, getZoom, getInternalNode } = useReactFlow();
    const pointerFocus = useRef(false);
    const panToCard = () => {
        if (pointerFocus.current) {
            pointerFocus.current = false;
            return;
        }
        const node = nodeId ? getInternalNode(nodeId) : undefined;
        if (!node) return;
        const { x, y } = node.internals.positionAbsolute;
        void setCenter(
            x + (node.measured.width ?? 0) / 2,
            y + (node.measured.height ?? 0) / 2,
            { zoom: getZoom(), duration: panDuration() },
        );
    };

    const dataTab = (s: RelationshipSummary) =>
        isExplorable(s.table)
            ? null
            : { filters: relationFilters(s, entry?.payload) };

    const missing = entry?.status === 'missing';
    return (
        <div
            data-selected={selected ? 'true' : undefined}
            className={cn(
                'relative flex w-[300px] flex-col rounded-lg border bg-card text-xs text-card-foreground shadow-sm',
                selected &&
                    'border-[var(--universe-accent)] ring-2 ring-[var(--universe-accent)]',
            )}
            style={{ maxHeight: CARD_MAX_HEIGHT }}
            onPointerDownCapture={() => {
                pointerFocus.current = true;
            }}
            onPointerUpCapture={() => {
                pointerFocus.current = false;
            }}
            onFocus={panToCard}
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
            {extraHandles.map((h) => (
                <Handle
                    key={h}
                    type="source"
                    id={h}
                    position={
                        h.endsWith(':out') ? Position.Left : Position.Right
                    }
                    isConnectable={false}
                    className={handleClass}
                />
            ))}
            {missing ? (
                <div className="flex items-center gap-2 px-3 py-3">
                    <button
                        type="button"
                        onClick={onSelect}
                        className="nodrag nopan min-w-0 truncate rounded text-left text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none"
                    >
                        {table} · {formatKey(recordKey)} not found
                    </button>
                    <button
                        type="button"
                        onClick={onRemove}
                        className="nodrag nopan ml-auto rounded border px-2 py-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none"
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
                    {/* Fields and ports scroll inside the capped card height; a scrolled-out port keeps its
                        (hidden) handle, so its edge still attaches at the port's real position. */}
                    <div className="nowheel nodrag min-h-0 flex-1 overflow-y-auto">
                        {fields.length > 0 && (
                            <div
                                role="group"
                                aria-label="Fields"
                                className="px-3 pb-2"
                            >
                                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                                    {fields.map((f) => (
                                        <div key={f.name} className="contents">
                                            <dt className="truncate text-muted-foreground">
                                                {f.name}
                                            </dt>
                                            <dd className="m-0 min-w-0 truncate font-mono">
                                                <FieldValue
                                                    value={f.value}
                                                    type={
                                                        types.get(f.name) ?? ''
                                                    }
                                                />
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            </div>
                        )}
                        {entry?.status === 'error' && (
                            <div className="flex items-center gap-2 border-t px-3 py-2">
                                <span className="text-destructive">
                                    {entry.error ??
                                        'Could not load the record.'}
                                </span>
                                <button
                                    type="button"
                                    onClick={onReload}
                                    className="nodrag nopan ml-auto rounded border px-2 py-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none"
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
                                        dataTab={dataTab(s)}
                                        onOpenInData={onOpenInData}
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
                                        dataTab={dataTab(s)}
                                        onOpenInData={onOpenInData}
                                    />
                                ))}
                            </PortGroup>
                        )}
                    </div>
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
    const snapshot = useContext(RecordsSnapshotContext);
    // Joined so the selector's result compares equal until the set of edge handles really changes.
    const handles = useRecords((s) => {
        const ids = new Set<string>();
        for (const e of s.trail.edges)
            if (e.from === data.id) ids.add(`${e.rel}:${e.dir}`);
        for (const c of Object.values(s.clusters))
            if (c.from === data.id)
                ids.add(`${c.summary.id}:${c.summary.direction}`);
        return [...ids].sort().join('\u0000');
    });
    return (
        <RecordCard
            table={data.table}
            recordKey={data.key}
            edgeHandles={handles === '' ? [] : handles.split('\u0000')}
            entry={entry}
            selected={selected}
            showInferred={showInferred}
            onExpand={(summary) =>
                useRecords.getState().expand(data.id, summary)
            }
            onSelect={() => useRecords.getState().select(data.id)}
            onRemove={() => useRecords.getState().remove(data.id)}
            onReload={() => useRecords.getState().reload(data.id)}
            isExplorable={(table) =>
                snapshot === null || explorableTable(snapshot, table) !== null
            }
            onOpenInData={(table, filters) => {
                const ws = useWorkspace.getState();
                ws.openDataFilter(table, filters);
                ws.select(table, 'data');
            }}
        />
    );
}
