import { Columns3 } from 'lucide-react';
import {
    lazy,
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { SortColumn } from 'react-data-grid';
import { toast } from 'sonner';
import { create } from 'zustand';
import {
    useBrowse,
    type TableTab,
    type TableTabState,
} from '@/browse/browse-store';
import {
    initialTotal,
    lastPage,
    rangeLabel,
    totalFromCount,
    type Total,
} from '@/browse/counts';
import {
    readGridLayout,
    writeGridLayout,
    type GridLayout,
} from '@/browse/local-prefs';
import { rowsCache, rowsRequestKey } from '@/browse/rows-cache';
import { reportTableRows } from '@/browse/sql-link';
import type { GridEditing } from '@/components/grid/result-grid';
import { FilterBar } from '@/components/inspector/filter-bar';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { pendingCounts, pendingKey, usePending } from '@/editing/pending-store';
import {
    dbErrorFrom,
    workspaceApi,
    type CountResponse,
    type PerPage,
    type RowFilter,
    type RowsResponse,
    type SortKey,
} from '@/lib/workspace-api';
import { openRecord, type RecordTarget } from '@/records/open-record';
import type {
    Dialect,
    QueryColumn,
    SchemaSnapshot,
    TableSchema,
} from '@/types/schema';
import { Pagination } from './pagination';
import { RowDrawer, RowDrawerLoading, type DrawerMotion } from './row-drawer';

/** The filter bar's first control; Ctrl+F focuses it. */
export const TABLE_FILTER_ID = 'table-filter-bar';

type FilterDraftRequest = { table: string; column: string; nonce: number };

const useFilterDraftRequest = create<{ request: FilterDraftRequest | null }>()(
    () => ({ request: null }),
);

/** One-shot: the next DataView of `table` starts a draft filter on `column` (palette column hits). */
export function requestFilterDraft(table: string, column: string): void {
    useFilterDraftRequest.setState((s) => ({
        request: { table, column, nonce: (s.request?.nonce ?? 0) + 1 },
    }));
}

// react-data-grid stays out of the workspace chunk until a table tab shows rows.
const ResultGrid = lazy(() =>
    import('@/components/grid/result-grid').then((m) => ({
        default: m.ResultGrid,
    })),
);

const NO_COLUMNS: QueryColumn[] = [];

type Props = {
    connectionId: number;
    snapshot: SchemaSnapshot;
    table: TableSchema;
    tab: TableTab;
    onOpenTable: (table: string, filters: RowFilter[]) => void;
    /** Bumped by the header's Refresh: drops the cached rows and refetches rows and count. */
    refreshNonce?: number;
    /** The connection is read-only: nothing is editable, whatever the rows response says. */
    readOnly?: boolean;
    /** Whether the loaded rows can be edited (the table tab shows + Add row). */
    onEditableChange?: (editable: boolean) => void;
};

type Request = {
    filters: RowFilter[];
    sort: SortKey[];
    page: number;
    perPage: PerPage;
};

/** The rows on screen and the request they answer. */
type View = { key: string; rows: RowsResponse; scrollTop: number };

/** What is known about the total for one set of filters. */
type CountState = {
    filtersKey: string;
    /** From the catalogue (unfiltered) or the cache; replaced by `count` once a count answers. */
    base: Total;
    count: CountResponse | null;
    /** The capped count failed for a reason other than the cap. */
    failed: boolean;
};

export function DataView(props: Props) {
    // A different tab is a different view: nothing (rows, layout, counts) carries over.
    return (
        <DataViewBody
            key={`${props.connectionId}:${props.tab.id}:${props.table.name}`}
            {...props}
        />
    );
}

function DataViewBody({
    connectionId,
    snapshot,
    table,
    tab,
    onOpenTable,
    refreshNonce = 0,
    readOnly = false,
    onEditableChange,
}: Props) {
    const name = table.name;
    // Per tab: two views of one table keep their own rows.
    const cacheKey = `${connectionId}:${tab.id}`;
    const { filters, sort, page, perPage, drawerRow } = tab.state;
    const requestKey = rowsRequestKey(tab.state);
    const filtersKey = JSON.stringify(filters);
    const dialect = snapshot.driver as Dialect;

    const [cached] = useState(() => {
        const hit = rowsCache.get(cacheKey);
        return hit && hit.requestKey === requestKey ? hit : null;
    });
    const [view, setView] = useState<View | null>(() =>
        cached
            ? {
                  key: cached.requestKey,
                  rows: cached.rows,
                  scrollTop: cached.scrollTop,
              }
            : null,
    );
    const [error, setError] = useState<{
        key: string;
        message: string;
    } | null>(null);
    const [reload, setReload] = useState(0);

    const rcCount = table.row_count.count;
    const rcKind = table.row_count.kind;
    const start = useMemo(
        () => initialTotal({ count: rcCount, kind: rcKind }, snapshot.driver),
        [rcCount, rcKind, snapshot.driver],
    );
    const [countState, setCountState] = useState<CountState>(() => ({
        filtersKey,
        base: cached ? cached.total : filters.length === 0 ? start.total : null,
        count: null,
        failed: cached?.countFailed ?? false,
    }));
    const [countPending, setCountPending] = useState(false);
    const [exactPending, setExactPending] = useState(false);
    const exactRequest = useRef<AbortController | null>(null);

    const update = useCallback(
        (patch: Partial<TableTabState>) =>
            useBrowse.getState().updateTable(connectionId, tab.id, patch),
        [connectionId, tab.id],
    );

    // The request the screen should answer; responses for any other are dropped.
    const latestKey = useRef(requestKey);
    useEffect(() => {
        latestKey.current = requestKey;
    }, [requestKey]);

    const lastRefresh = useRef(refreshNonce);
    useEffect(() => {
        const forced = lastRefresh.current !== refreshNonce;
        lastRefresh.current = refreshNonce;
        if (forced) rowsCache.delete(cacheKey);
        const hit = rowsCache.get(cacheKey);
        if (hit && hit.requestKey === requestKey) {
            setView((v) =>
                v?.key === requestKey
                    ? v
                    : {
                          key: requestKey,
                          rows: hit.rows,
                          scrollTop: hit.scrollTop,
                      },
            );
            return;
        }
        const controller = new AbortController();
        const body = JSON.parse(requestKey) as Request;
        setError(null);
        workspaceApi
            .rows(
                connectionId,
                name,
                {
                    filters: body.filters,
                    sort: body.sort,
                    page: body.page,
                    per_page: body.perPage,
                },
                controller.signal,
            )
            .then((rows) => {
                if (
                    controller.signal.aborted ||
                    latestKey.current !== requestKey
                )
                    return;
                // Not counted yet; the total is patched in once this view renders.
                rowsCache.set(cacheKey, {
                    requestKey,
                    rows,
                    total: null,
                    scrollTop: 0,
                });
                setView({ key: requestKey, rows, scrollTop: 0 });
                // A linked editor tab follows the query; a refetch of the same request is not a new one.
                reportTableRows(connectionId, tab.id, requestKey, rows.sql);
            })
            .catch((e) => {
                if (
                    controller.signal.aborted ||
                    latestKey.current !== requestKey
                )
                    return;
                setError({
                    key: requestKey,
                    message: dbErrorFrom(e, 'Could not load rows.').message,
                });
            });
        return () => controller.abort();
    }, [
        connectionId,
        name,
        cacheKey,
        requestKey,
        refreshNonce,
        reload,
        tab.id,
    ]);

    // Counting runs beside the rows request and never holds it up. A view restored from the cache
    // sends no count; if its count never finished, "Count exactly" offers to run one.
    const countedFor = useRef<string | null>(
        cached ? `${filtersKey}#${refreshNonce}` : null,
    );
    useEffect(() => {
        const token = `${filtersKey}#${refreshNonce}`;
        if (countedFor.current === token) return;
        countedFor.current = token;
        exactRequest.current?.abort();
        setExactPending(false);
        const f = JSON.parse(filtersKey) as RowFilter[];
        const unfiltered = f.length === 0;
        setCountState({
            filtersKey,
            base: unfiltered ? start.total : null,
            count: null,
            failed: false,
        });
        if (unfiltered && !start.autoCount) return;
        const controller = new AbortController();
        let settled = false;
        setCountPending(true);
        workspaceApi
            .count(
                connectionId,
                name,
                { filters: f, exact: false },
                controller.signal,
            )
            .then((res) => {
                settled = true;
                if (controller.signal.aborted) return;
                setCountPending(false);
                setCountState((s) =>
                    s.filtersKey === filtersKey ? { ...s, count: res } : s,
                );
            })
            .catch(() => {
                settled = true;
                if (controller.signal.aborted) return;
                setCountPending(false);
                setCountState((s) =>
                    s.filtersKey === filtersKey ? { ...s, failed: true } : s,
                );
            });
        return () => {
            controller.abort();
            setCountPending(false);
            // An interrupted count is asked again if the same filters come back.
            if (!settled) countedFor.current = null;
        };
    }, [connectionId, name, filtersKey, refreshNonce, start]);

    useEffect(() => () => exactRequest.current?.abort(), []);

    const rowsSeen = view
        ? (view.rows.page - 1) * view.rows.per_page + view.rows.rows.length
        : 0;
    const total: Total = useMemo(() => {
        if (countState.failed) return null;
        return countState.count
            ? totalFromCount(countState.count, rowsSeen)
            : countState.base;
    }, [countState, rowsSeen]);

    // Only the entry for the request on screen takes the total, and only a total for its filters.
    const countFailed = countState.failed;
    const countFor = countState.filtersKey;
    useEffect(() => {
        if (
            !view ||
            view.key !== requestKey ||
            countFor !== filtersKey ||
            rowsCache.get(cacheKey)?.requestKey !== view.key
        )
            return;
        rowsCache.patch(cacheKey, { total, countFailed });
    }, [cacheKey, total, countFailed, countFor, filtersKey, requestKey, view]);

    const countExactly = () => {
        exactRequest.current?.abort();
        const controller = new AbortController();
        exactRequest.current = controller;
        const key = filtersKey;
        setExactPending(true);
        workspaceApi
            .count(
                connectionId,
                name,
                { filters, exact: true },
                controller.signal,
            )
            .then((res) => {
                if (controller.signal.aborted) return;
                setCountState((s) =>
                    s.filtersKey === key
                        ? { ...s, count: res, failed: false }
                        : s,
                );
            })
            .catch((e) => {
                if (controller.signal.aborted) return;
                toast.error(dbErrorFrom(e, 'Could not count rows.').message);
            })
            .finally(() => {
                if (!controller.signal.aborted) setExactPending(false);
            });
    };

    const retry = () => {
        rowsCache.delete(cacheKey);
        setError(null);
        setReload((n) => n + 1);
    };

    const [draft, setDraft] = useState<{
        column: string;
        nonce: number;
    } | null>(null);
    const draftRequest = useFilterDraftRequest((s) => s.request);
    useEffect(() => {
        if (!draftRequest || draftRequest.table !== name) return;
        setDraft({ column: draftRequest.column, nonce: draftRequest.nonce });
        useFilterDraftRequest.setState({ request: null });
    }, [draftRequest, name]);

    const changeFilters = useCallback(
        (next: RowFilter[]) =>
            update({ filters: next, page: 1, drawerRow: null }),
        [update],
    );
    const filterColumns = useMemo(
        () => table.columns.map((c) => c.name),
        [table.columns],
    );

    const columns = view?.rows.columns ?? NO_COLUMNS;
    // Rows of this tab all come from this table, whatever the driver reports for the column origin.
    const recordColumns = useMemo(
        () => columns.map((c) => ({ ...c, table: name })),
        [columns, name],
    );

    const sortColumns: SortColumn[] = useMemo(
        () =>
            sort.flatMap((s) => {
                const index = columns.findIndex((c) => c.name === s.column);
                return index < 0
                    ? []
                    : [
                          {
                              columnKey: String(index),
                              direction: s.direction === 'asc' ? 'ASC' : 'DESC',
                          } as const,
                      ];
            }),
        [sort, columns],
    );
    const gridSort = useMemo(
        () => ({
            columns: sortColumns,
            maxKeys: 3,
            onChange: (next: SortColumn[]) =>
                update({
                    sort: next.flatMap((sc) => {
                        const column = columns[Number(sc.columnKey)];
                        return column
                            ? [
                                  {
                                      column: column.name,
                                      direction:
                                          sc.direction === 'ASC'
                                              ? ('asc' as const)
                                              : ('desc' as const),
                                  },
                              ]
                            : [];
                    }),
                    page: 1,
                    drawerRow: null,
                }),
        }),
        [sortColumns, columns, update],
    );

    const [layoutValue, setLayoutValue] = useState<GridLayout>(() =>
        readGridLayout(connectionId, name),
    );
    const changeLayout = useCallback(
        (next: GridLayout) => {
            setLayoutValue(next);
            writeGridLayout(connectionId, name, next);
            // Resizing or hiding a column is an interaction that keeps a preview tab (spec 4.3).
            useBrowse.getState().promote(connectionId, tab.id);
        },
        [connectionId, name, tab.id],
    );
    const gridLayout = useMemo(
        () => ({ value: layoutValue, onChange: changeLayout }),
        [layoutValue, changeLayout],
    );

    const onFilterColumn = useCallback(
        (column: string) =>
            setDraft((d) => ({ column, nonce: (d?.nonce ?? 0) + 1 })),
        [],
    );
    const onOpenRow = useCallback(
        (rowIndex: number) => update({ drawerRow: rowIndex }),
        [update],
    );
    const gridArea = useRef<HTMLDivElement>(null);
    const closeDrawer = useCallback(() => {
        update({ drawerRow: null });
        // Focus goes back to the row that was open, else the grid itself.
        requestAnimationFrame(() => {
            const target =
                gridArea.current?.querySelector<HTMLElement>(
                    `button[data-row-index="${lastOpened.current}"]`,
                ) ??
                gridArea.current?.querySelector<HTMLElement>('[role="grid"]');
            target?.focus();
        });
    }, [update]);
    const lastOpened = useRef(0);
    useEffect(() => {
        if (drawerRow !== null) lastOpened.current = drawerRow;
    }, [drawerRow]);
    const onStep = useCallback(
        (dir: 1 | -1) => {
            const count = view?.rows.rows.length ?? 0;
            const at = drawerRow ?? 0;
            const next = at + dir;
            if (next >= 0 && next < count) update({ drawerRow: next });
            else if (next >= count && view?.rows.has_more)
                update({ page: page + 1, drawerRow: 0 });
            else if (next < 0 && page > 1)
                update({ page: page - 1, drawerRow: perPage - 1 });
        },
        [view, drawerRow, page, perPage, update],
    );
    const onExplore = useCallback(
        (target: RecordTarget) => openRecord(target),
        [],
    );
    const onOpenForeign = useCallback(
        (target: string, column: string, value: string) =>
            onOpenTable(target, [{ column, op: 'eq', value }]),
        [onOpenTable],
    );
    const onScrollTopChange = useCallback(
        (top: number) => rowsCache.patch(cacheKey, { scrollTop: top }),
        [cacheKey],
    );
    const rowMenu = useMemo(() => ({ dialect, table: name }), [dialect, name]);

    // Staged editing (spec 4.1): only a table whose rows can be pinned, on a writable connection.
    const loaded = view?.rows;
    const editing: GridEditing | undefined = useMemo(() => {
        if (readOnly || !loaded?.editing || loaded.editing.method === 'none')
            return undefined;
        return {
            connectionId,
            table: name,
            dialect,
            rowIds: loaded.row_ids,
            locked: loaded.locked,
            shortened: loaded.shortened ?? [],
            readOnlyColumns: loaded.editing.read_only_columns,
            rowReason: loaded.editing.reason,
            tableColumns: table.columns,
        };
    }, [readOnly, loaded, connectionId, name, dialect, table.columns]);
    const editable = !!editing;
    useEffect(() => {
        if (view) onEditableChange?.(editable);
    }, [editable, view, onEditableChange]);

    // Pending changes belong to the table, so changes made on other pages (or in other views) count too.
    const pendingRows = usePending(
        (s) => s.byTable[pendingKey(connectionId, name)],
    );
    const pending = useMemo(
        () => (pendingRows ? pendingCounts(pendingRows) : null),
        [pendingRows],
    );
    const pendingTotal = pending
        ? pending.inserted + pending.updated + pending.deleted
        : 0;

    const currentError = error?.key === requestKey ? error.message : null;
    const loading = !currentError && view?.key !== requestKey;
    // Offered for estimates and lower bounds, and when there is no total (not counted, or the capped count failed).
    const showExact =
        !!view &&
        !countPending &&
        (!total || 'atLeast' in total || !total.exact);
    const drawerRowData =
        !loading && drawerRow !== null
            ? (view?.rows.rows[drawerRow] ?? null)
            : null;
    // The drawer slides in when it opens; moving to another row while it is open only flashes its
    // header, so stepping through rows stays quick but the swap is still noticed.
    const drawerAt =
        drawerRow === null ? null : (page - 1) * perPage + drawerRow;
    const [drawerMotion, setDrawerMotion] = useState<{
        at: number | null;
        kind: DrawerMotion;
    }>({ at: null, kind: 'open' });
    if (drawerAt !== drawerMotion.at)
        setDrawerMotion({
            at: drawerAt,
            kind: drawerMotion.at === null ? 'open' : 'change',
        });
    // A row beyond a short page no longer exists.
    const rowsOnPage = view?.rows.rows.length ?? 0;
    useEffect(() => {
        if (!loading && drawerRow !== null && view && drawerRow >= rowsOnPage)
            update({ drawerRow: null });
    }, [loading, drawerRow, view, rowsOnPage, update]);
    const label = view
        ? rangeLabel(
              view.rows.page,
              view.rows.per_page,
              view.rows.rows.length,
              total,
          )
        : loading
          ? 'Loading rows…'
          : 'No rows';

    return (
        <div className="flex h-full min-h-0 flex-col">
            <FilterBar
                id={TABLE_FILTER_ID}
                columns={filterColumns}
                filters={filters}
                onChange={changeFilters}
                draft={draft}
            />
            <div className="flex min-h-0 flex-1">
                <div ref={gridArea} className="relative min-h-0 min-w-0 flex-1">
                    {currentError ? (
                        <div
                            role="alert"
                            className="flex flex-col items-start gap-2 px-4 py-3 text-xs"
                        >
                            <p className="text-destructive">{currentError}</p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={retry}
                            >
                                Retry
                            </Button>
                        </div>
                    ) : view && view.rows.columns.length > 0 ? (
                        <div
                            aria-busy={loading}
                            className={
                                loading
                                    ? 'h-full opacity-60 transition-opacity'
                                    : 'h-full'
                            }
                        >
                            <Suspense
                                fallback={
                                    <p className="px-4 py-3 text-xs text-muted-foreground">
                                        Loading rows…
                                    </p>
                                }
                            >
                                <ResultGrid
                                    key={view.key}
                                    columns={recordColumns}
                                    rows={view.rows.rows}
                                    snapshot={snapshot}
                                    onOpenForeign={onOpenForeign}
                                    onOpenRecord={openRecord}
                                    sort={gridSort}
                                    layout={gridLayout}
                                    onFilterColumn={onFilterColumn}
                                    onOpenRow={onOpenRow}
                                    activeRow={drawerRow}
                                    rowMenu={rowMenu}
                                    scrollTop={view.scrollTop}
                                    onScrollTopChange={onScrollTopChange}
                                    editing={editing}
                                />
                            </Suspense>
                        </div>
                    ) : (
                        <p className="px-4 py-3 text-xs text-muted-foreground">
                            {loading ? 'Loading rows…' : 'No rows.'}
                        </p>
                    )}
                </div>
                {drawerRow !== null &&
                    (drawerRowData ? (
                        <RowDrawer
                            key={`${page}:${drawerRow}`}
                            connectionId={connectionId}
                            snapshot={snapshot}
                            table={table}
                            columns={recordColumns}
                            row={drawerRowData}
                            rowNumber={(page - 1) * perPage + drawerRow + 1}
                            motion={drawerMotion.kind}
                            onClose={closeDrawer}
                            onStep={onStep}
                            onOpenTable={onOpenTable}
                            onExplore={onExplore}
                        />
                    ) : loading ? (
                        <RowDrawerLoading
                            motion={drawerMotion.kind}
                            onClose={closeDrawer}
                        />
                    ) : null)}
            </div>
            <Pagination
                page={page}
                perPage={perPage}
                lastPage={lastPage(total, perPage)}
                hasMore={view?.rows.has_more ?? false}
                disabled={!view || loading}
                label={label}
                onPage={(p) => update({ page: p, drawerRow: null })}
                onPerPage={(n) =>
                    update({ perPage: n, page: 1, drawerRow: null })
                }
            >
                {pending && pendingTotal > 0 && (
                    <span
                        role="status"
                        className="font-medium text-warning-foreground"
                    >
                        {`${pendingTotal} pending change${pendingTotal === 1 ? '' : 's'} · ${pending.inserted} new · ${pending.updated} edited · ${pending.deleted} deleted`}
                    </span>
                )}
                {view && countState.failed && (
                    <span className="text-muted-foreground">
                        count unavailable
                    </span>
                )}
                {showExact && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        disabled={exactPending}
                        onClick={countExactly}
                    >
                        {exactPending && <Spinner className="size-3" />}
                        Count exactly
                    </Button>
                )}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                        >
                            <Columns3 className="size-3.5" /> Columns
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="start"
                        className="max-h-80 overflow-y-auto"
                    >
                        {filterColumns.map((column) => (
                            <DropdownMenuCheckboxItem
                                key={column}
                                className="font-mono text-xs"
                                checked={!layoutValue.hidden.includes(column)}
                                onSelect={(e) => e.preventDefault()}
                                onCheckedChange={(checked) =>
                                    changeLayout({
                                        ...layoutValue,
                                        hidden: checked
                                            ? layoutValue.hidden.filter(
                                                  (h) => h !== column,
                                              )
                                            : [...layoutValue.hidden, column],
                                    })
                                }
                            >
                                {column}
                            </DropdownMenuCheckboxItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onSelect={() =>
                                changeLayout({ widths: {}, hidden: [] })
                            }
                        >
                            Reset
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </Pagination>
        </div>
    );
}
