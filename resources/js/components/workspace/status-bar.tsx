import { useMemo } from 'react';
import { useActiveTab, type BrowseTab } from '@/browse/browse-store';
import type { Total } from '@/browse/counts';
import { useTabStatus } from '@/browse/status-store';
import { pendingCounts, pendingKey, usePending } from '@/editing/pending-store';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { DatabaseInfo } from '@/components/workspace/database-info';
import { useReview } from '@/editing/review-store';
import {
    formatConnectionTarget,
    formatSnapshotAge,
    shortVersion,
} from '@/lib/format';
import { dockShortcutHint } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { toggleDock } from '@/lib/workspace-shortcuts';
import { useRecords } from '@/records/records-store';
import type { ConnectionSummary, WorkspaceRef } from '@/types/connection';
import type { SchemaSnapshot, ServerInfo } from '@/types/schema';
import { useWorkspace } from '@/universe/store';

const full = new Intl.NumberFormat('en');
const plural = (n: number, one: string, many: string) =>
    `${full.format(n)} ${n === 1 ? one : many}`;

const ITEM = 'flex h-full shrink-0 items-center gap-1.5 border-r px-3';
const RIGHT_ITEM = 'flex h-full shrink-0 items-center gap-1.5 border-l px-3';

/** "Rows 101–200 of 1,234" ("of ~1,234" for an estimate, "of 1,234+" for a lower bound), or "No rows". */
export function statusRangeLabel(from: number, to: number, total: Total) {
    if (to === 0) return 'No rows';
    const range = `Rows ${full.format(from)}–${full.format(to)}`;
    if (!total) return range;
    if ('atLeast' in total) return `${range} of ${full.format(total.atLeast)}+`;
    return `${range} of ${total.exact ? '' : '~'}${full.format(total.count)}`;
}

/**
 * The workspace footer (spec 1.2): the connection, what the active tab shows, the snapshot age and the SQL dock
 * toggle. Not a live region: its numbers change too often to announce.
 */
export function StatusBar({
    connection,
    snapshot,
    server,
    storedAt,
}: {
    connection: ConnectionSummary;
    snapshot: SchemaSnapshot | null;
    server: ServerInfo | null;
    storedAt: string | null;
}) {
    const engine = server
        ? `${connection.driver_label} ${shortVersion(server.version)}`
        : connection.driver_label;
    const active = useActiveTab(connection.ref);
    const dockOpen = useWorkspace((s) => s.dockOpen);

    return (
        <footer
            aria-label="Status bar"
            className="flex h-[26px] shrink-0 items-center overflow-hidden border-t bg-sidebar text-xs text-muted-foreground"
        >
            <Popover>
                <PopoverTrigger
                    aria-label={`${engine}, database info`}
                    className={cn(
                        ITEM,
                        'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
                    )}
                >
                    <span
                        className="size-2 rounded-full"
                        style={{
                            background:
                                connection.color ?? 'var(--universe-accent)',
                        }}
                        aria-hidden
                    />
                    {engine}
                </PopoverTrigger>
                <PopoverContent
                    side="top"
                    align="start"
                    aria-label="Database info"
                    className="w-80 p-3"
                >
                    <DatabaseInfo
                        connection={connection}
                        server={server}
                        snapshot={snapshot}
                        storedAt={storedAt}
                    />
                </PopoverContent>
            </Popover>
            <span
                className={cn(ITEM, 'min-w-0 shrink font-mono')}
                title={formatConnectionTarget(connection)}
            >
                <span className="truncate">
                    {formatConnectionTarget(connection)}
                </span>
            </span>
            {connection.read_only && <span className={ITEM}>read-only</span>}

            <TabItems
                connectionId={connection.ref}
                active={active}
                snapshot={snapshot}
            />

            <span className="ml-auto" />
            {storedAt && (
                <span className={cn(RIGHT_ITEM, 'hidden lg:flex')}>
                    <time dateTime={storedAt} title={storedAt}>
                        Snapshot {formatSnapshotAge(storedAt)}
                    </time>
                </span>
            )}
            <button
                type="button"
                aria-pressed={dockOpen}
                aria-keyshortcuts="Control+J Meta+J"
                onClick={() => toggleDock()}
                className={cn(
                    RIGHT_ITEM,
                    'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset aria-pressed:text-foreground',
                )}
            >
                SQL{' '}
                <kbd className="font-mono text-[10px]">
                    {dockShortcutHint()}
                </kbd>
            </button>
        </footer>
    );
}

function TabItems({
    connectionId,
    active,
    snapshot,
}: {
    connectionId: WorkspaceRef;
    active: BrowseTab;
    snapshot: SchemaSnapshot | null;
}) {
    if (active.kind === 'table')
        return (
            <TableItems
                connectionId={connectionId}
                tabId={active.id}
                table={active.table}
            />
        );
    if (active.kind === 'records') return <RecordItems />;
    return snapshot ? <UniverseItems snapshot={snapshot} /> : null;
}

function TableItems({
    connectionId,
    tabId,
    table,
}: {
    connectionId: WorkspaceRef;
    tabId: string;
    table: string;
}) {
    const status = useTabStatus((s) => s.byTab[tabId]);
    // Subscribed, so staging an edit updates the count.
    const rows = usePending((s) => s.byTable[pendingKey(connectionId, table)]);
    const counts = pendingCounts(rows ?? {});
    const pending = counts.inserted + counts.updated + counts.deleted;

    return (
        <>
            {status && (
                <>
                    <span
                        className={cn(
                            ITEM,
                            'min-w-0 shrink truncate tabular-nums',
                        )}
                    >
                        {statusRangeLabel(status.from, status.to, status.total)}
                    </span>
                    <span className={cn(ITEM, 'hidden tabular-nums md:flex')}>
                        {full.format(Math.round(status.ms))} ms
                    </span>
                </>
            )}
            {pending > 0 && (
                <button
                    type="button"
                    onClick={() =>
                        useReview.getState().openReview(connectionId, table)
                    }
                    className={cn(
                        ITEM,
                        'bg-warning/10 text-warning-foreground hover:bg-warning/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
                    )}
                >
                    {plural(pending, 'pending change', 'pending changes')}
                </button>
            )}
        </>
    );
}

function UniverseItems({ snapshot }: { snapshot: SchemaSnapshot }) {
    const showInferred = useWorkspace((s) => s.showInferred);
    const relations = useMemo(
        () =>
            showInferred
                ? snapshot.relationships.length
                : snapshot.relationships.filter((r) => !r.inferred).length,
        [snapshot, showInferred],
    );
    return (
        <span className={cn(ITEM, 'tabular-nums')}>
            {plural(snapshot.tables.length, 'table', 'tables')} ·{' '}
            {plural(relations, 'relation', 'relations')}
        </span>
    );
}

function RecordItems() {
    const records = useRecords((s) => s.trail.nodes.length);
    return (
        <span className={cn(ITEM, 'tabular-nums')}>
            {plural(records, 'record', 'records')}
        </span>
    );
}
