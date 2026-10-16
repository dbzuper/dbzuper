import { Code2, Copy, RefreshCw, Star } from 'lucide-react';
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
import { rowsCache, rowsRequestKey } from '@/browse/rows-cache';
import { openTableTab } from '@/browse/table-actions';
import { tabDomId } from '@/components/browse/tab-bar';
import type { TableActions } from '@/components/browse/table-context-menu';
import { Button } from '@/components/ui/button';
import { quoteIdent, writeClipboard } from '@/grid/copy';
import type { RowFilter } from '@/lib/workspace-api';
import { cn } from '@/lib/utils';
import { useSqlTabs } from '@/sql/tabs-store';
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
        rowsCache.delete(`${connectionId}:${tab.table}`);
        setRefreshNonce((n) => n + 1);
    };

    const setView = (view: TableView) =>
        useBrowse.getState().updateTable(connectionId, tab.id, { view });

    /** The SQL of the cached rows when they answer the tab's current request, else a plain first-page SELECT. */
    const selectSql = () => {
        const hit = rowsCache.get(`${connectionId}:${tab.table}`);
        return hit && hit.requestKey === rowsRequestKey(tab.state)
            ? hit.rows.sql
            : `SELECT * FROM ${quoteIdent(connection.driver, tab.table)} LIMIT 100`;
    };

    const openInSql = () => {
        useSqlTabs.getState().openTab(connectionId, selectSql(), tab.table);
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
                    />
                )}
            </div>
        </div>
    );
}
