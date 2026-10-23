import { Code2, Copy, Plus, RefreshCw, Star } from 'lucide-react';
import {
    useCallback,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
} from 'react';
import { toast } from 'sonner';
import {
    useBrowse,
    type TableTab,
    type TableView,
} from '@/browse/browse-store';
import { usePins } from '@/browse/pins-store';
import { rowsCache } from '@/browse/rows-cache';
import { openTableTabInSql, tableTabSql } from '@/browse/sql-link';
import { openTableTab } from '@/browse/table-actions';
import { tabDomId } from '@/components/browse/tab-bar';
import type { TableActions } from '@/components/browse/table-context-menu';
import { ReviewDialog } from '@/components/editing/review-dialog';
import { Button } from '@/components/ui/button';
import { usePending } from '@/editing/pending-store';
import { writeClipboard } from '@/grid/copy';
import type { RowFilter } from '@/lib/workspace-api';
import { cn } from '@/lib/utils';
import type { ConnectionSummary } from '@/types/connection';
import type { SchemaSnapshot } from '@/types/schema';
import { useWorkspace } from '@/universe/store';
import { DataView } from './data-view';
import { StructureView } from './structure-view';

/** The table name heading; labels the tab panel. */
export const tableHeadingId = (tabId: string) => `${tabDomId(tabId)}-heading`;

const VIEWS: { value: TableView; label: string }[] = [
    { value: 'data', label: 'Data' },
    { value: 'structure', label: 'Structure' },
];

type Props = {
    connection: ConnectionSummary;
    snapshot: SchemaSnapshot;
    tab: TableTab;
    actions: TableActions;
};

export function TableTabView({ connection, snapshot, tab, actions }: Props) {
    const connectionId = connection.id;
    const table = useMemo(
        () => snapshot.tables.find((t) => t.name === tab.table),
        [snapshot, tab.table],
    );
    const [refreshNonce, setRefreshNonce] = useState(0);
    // Reported by the Data view once its rows say whether they can be edited; a preview tab that moves to
    // another table forgets it.
    const [editableTable, setEditableTable] = useState<string | null>(null);
    const editable = editableTable === tab.table;
    const tableName = tab.table;
    const onEditableChange = useCallback(
        (can: boolean) => setEditableTable(can ? tableName : null),
        [tableName],
    );
    const pinned = usePins(
        (s) =>
            s.byConnection[connectionId]?.some((p) => p.table === tab.table) ??
            false,
    );
    const radios = useRef<(HTMLButtonElement | null)[]>([]);

    const openFiltered = useCallback(
        (target: string, filters: RowFilter[]) =>
            openTableTab(connectionId, target, {
                mode: 'permanent',
                state: { filters },
            }),
        [connectionId],
    );
    const openRelated = useCallback(
        (target: string) => actions.open(target, 'preview'),
        [actions],
    );

    // Dropping the cached rows first means a Data view mounted later (after Structure) refetches too.
    const refresh = () => {
        rowsCache.delete(`${connectionId}:${tab.id}`);
        setRefreshNonce((n) => n + 1);
    };

    // Committed rows are stale in every view of the table; this view refetches now (a linked SQL editor follows
    // as usual), the others when shown again.
    const onCommitted = useCallback(() => {
        for (const t of useBrowse.getState().get(connectionId).tabs)
            if (t.kind === 'table' && t.table === tableName)
                rowsCache.delete(`${connectionId}:${t.id}`);
        setRefreshNonce((n) => n + 1);
    }, [connectionId, tableName]);

    // A new row goes to the top of the grid, staged with every view of the table (spec 4.1).
    const addRow = () => {
        usePending.getState().addRow(connectionId, tab.table);
        useBrowse.getState().promote(connectionId, tab.id);
    };

    const setView = (view: TableView) =>
        useBrowse.getState().updateTable(connectionId, tab.id, { view });

    const selectSql = () =>
        tableTabSql(connectionId, tab, connection.driver, table?.columns ?? []);

    // The editor tab stays linked to this tab: it follows the tab's query, and a fitting Run sets the tab.
    const openInSql = () => {
        openTableTabInSql(
            connectionId,
            tab,
            connection.driver,
            table?.columns ?? [],
        );
        useWorkspace.getState().setDockOpen(true);
    };

    const copySelect = async () => {
        if (await writeClipboard(selectSql())) toast.success('Copied SELECT');
        else toast.error('Could not copy');
    };

    const onRadioKey = (e: KeyboardEvent, index: number) => {
        if (
            !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
        )
            return;
        e.preventDefault();
        const next = (index + 1) % VIEWS.length;
        setView(VIEWS[next].value);
        radios.current[next]?.focus();
    };

    if (!table)
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm">
                <p className="text-muted-foreground">
                    This table no longer exists:{' '}
                    <span className="font-mono text-foreground">
                        {tab.table}
                    </span>
                </p>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                        useBrowse.getState().closeTab(connectionId, tab.id)
                    }
                >
                    Close tab
                </Button>
            </div>
        );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
                <h2
                    id={tableHeadingId(tab.id)}
                    className="min-w-0 truncate font-mono text-sm font-semibold"
                >
                    {table.name}
                </h2>
                <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {table.kind}
                </span>
                <div
                    role="radiogroup"
                    aria-label="Table view"
                    className="ml-2 flex rounded-md border p-0.5"
                >
                    {VIEWS.map((v, i) => {
                        const checked = tab.state.view === v.value;
                        return (
                            <button
                                key={v.value}
                                ref={(el) => {
                                    radios.current[i] = el;
                                }}
                                type="button"
                                role="radio"
                                aria-checked={checked}
                                tabIndex={checked ? 0 : -1}
                                className={cn(
                                    'rounded px-2.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    checked
                                        ? 'bg-muted font-medium text-foreground'
                                        : 'text-muted-foreground hover:text-foreground',
                                )}
                                onClick={() => setView(v.value)}
                                onKeyDown={(e) => onRadioKey(e, i)}
                            >
                                {v.label}
                            </button>
                        );
                    })}
                </div>
                <div className="ml-auto flex items-center gap-1">
                    {editable &&
                        !connection.read_only &&
                        tab.state.view === 'data' && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={addRow}
                            >
                                <Plus className="size-3.5" /> Add row
                            </Button>
                        )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={refresh}
                    >
                        <RefreshCw className="size-3.5" /> Refresh
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={openInSql}
                    >
                        <Code2 className="size-3.5" /> Open in SQL
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void copySelect()}
                    >
                        <Copy className="size-3.5" /> Copy SELECT
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={pinned ? 'Unpin table' : 'Pin table'}
                        aria-pressed={pinned}
                        onClick={() =>
                            void usePins
                                .getState()
                                .toggle(connectionId, tab.table)
                        }
                    >
                        <Star
                            className={cn(
                                'size-4',
                                pinned && 'fill-current text-warning',
                            )}
                        />
                    </Button>
                </div>
            </div>
            <div className="min-h-0 flex-1">
                {tab.state.view === 'structure' ? (
                    <StructureView
                        key={refreshNonce}
                        connectionId={connectionId}
                        snapshot={snapshot}
                        table={table}
                        onOpenTable={openRelated}
                    />
                ) : (
                    <DataView
                        connectionId={connectionId}
                        snapshot={snapshot}
                        table={table}
                        tab={tab}
                        onOpenTable={openFiltered}
                        refreshNonce={refreshNonce}
                        readOnly={connection.read_only}
                        onEditableChange={onEditableChange}
                    />
                )}
            </div>
            <ReviewDialog
                connectionId={connectionId}
                table={tableName}
                onCommitted={onCommitted}
            />
        </div>
    );
}
