import { create } from 'zustand';
import {
    persist,
    type PersistStorage,
    type StorageValue,
} from 'zustand/middleware';
import { filterChipText, isDateOp } from '@/lib/date-filter';
import {
    FILTER_OPS,
    PER_PAGE_OPTIONS,
    type PerPage,
    type RowFilter,
    type SortKey,
} from '@/lib/workspace-api';
import { rowsCache } from './rows-cache';
import { safeStorage } from './safe-storage';
import { isWorkspaceRef, type WorkspaceRef } from '@/types/connection';

export type TableView = 'data' | 'structure';
export type TableTabState = {
    filters: RowFilter[];
    sort: SortKey[];
    page: number;
    perPage: PerPage;
    view: TableView;
    /** Index of the row shown in the drawer, within the current page; null when closed. */
    drawerRow: number | null;
};
export type BrowseTab =
    | { id: 'universe'; kind: 'universe' }
    | { id: 'records'; kind: 'records'; title: string }
    | {
          id: string;
          kind: 'table';
          table: string;
          /** 1 for the first tab of a table, then the lowest free number from 2 (`orders (2)`). */
          ordinal: number;
          /** When this tab was last active, on a per-connection clock: the latest tab of a table has the highest. */
          activatedAt: number;
          preview: boolean;
          state: TableTabState;
      };
export type TableTab = Extract<BrowseTab, { kind: 'table' }>;
export type ConnectionBrowse = {
    tabs: BrowseTab[];
    activeId: string;
    recents: string[];
    perPage: PerPage;
};
export type OpenMode = 'preview' | 'permanent' | 'background';

export const UNIVERSE_TAB: BrowseTab = { id: 'universe', kind: 'universe' };
export const MAX_RECENTS = 10;

/** A table tab id, stable for the life of the tab and across reloads. */
export const newTabId = (): string =>
    `t:${
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    }`;
const TAB_ID = /^t:[A-Za-z0-9-]{1,64}$/;

/** `orders` for the first view of a table, `orders (2)` for the next. */
export function tabTitle(tab: TableTab): string {
    return tab.ordinal === 1 ? tab.table : `${tab.table} (${tab.ordinal})`;
}

const OP_SYMBOLS: Partial<Record<RowFilter['op'], string>> = {
    eq: '=',
    neq: '≠',
};

/**
 * The filters of a tab in one line, e.g. `status = paid · total > 100 · created_at on 1 Oct 2026`; empty when
 * there are none.
 */
export function filterSummary(state: TableTabState): string {
    return state.filters
        .map((f) => {
            // Date filters read as their chips do; the tab does not know the column kinds, but these operators
            // only exist on date columns.
            if (isDateOp(f.op)) return filterChipText(f, 'datetime');
            const op =
                OP_SYMBOLS[f.op] ??
                FILTER_OPS.find((o) => o.value === f.op)?.label ??
                f.op;
            return f.value === undefined
                ? `${f.column} ${op}`
                : `${f.column} ${op} ${f.value}`;
        })
        .join(' · ');
}

const isTable = (t: BrowseTab): t is TableTab => t.kind === 'table';

/** The open tab of `table` that was active most recently, or null. */
function latestOf(tabs: BrowseTab[], table: string): TableTab | null {
    let latest: TableTab | null = null;
    for (const t of tabs)
        if (
            isTable(t) &&
            t.table === table &&
            (!latest || t.activatedAt > latest.activatedAt)
        )
            latest = t;
    return latest;
}

/** 1 when no tab shows `table`, else the lowest number from 2 that none of its tabs uses. */
function nextOrdinal(tabs: BrowseTab[], table: string): number {
    const used = new Set(
        tabs
            .filter(isTable)
            .flatMap((t) => (t.table === table ? [t.ordinal] : [])),
    );
    if (used.size === 0) return 1;
    let n = 2;
    while (used.has(n)) n++;
    return n;
}

/** The next value of a connection's activation clock. */
const nextStamp = (tabs: BrowseTab[]) =>
    tabs.reduce(
        (max, t) => (isTable(t) ? Math.max(max, t.activatedAt) : max),
        0,
    ) + 1;

/** Makes `id` the active tab, stamping it as the latest of its table. */
function focus(c: ConnectionBrowse, id: string): ConnectionBrowse {
    const tab = c.tabs.find((t) => t.id === id);
    if (!tab) return c;
    if (!isTable(tab)) return c.activeId === id ? c : { ...c, activeId: id };
    const stamp = nextStamp(c.tabs);
    if (tab.activatedAt === stamp - 1 && c.activeId === id) return c;
    return {
        ...c,
        activeId: id,
        tabs: c.tabs.map((t) =>
            t.id === id && isTable(t) ? { ...t, activatedAt: stamp } : t,
        ),
    };
}

/** The latest tab of `table` on a connection (the one opening it focuses), or null. */
export function latestTableTab(
    connectionId: WorkspaceRef,
    table: string,
): TableTab | null {
    const c = useBrowse.getState().byConnection[connectionId];
    return c ? latestOf(c.tabs, table) : null;
}

const DEFAULT_PER_PAGE: PerPage = 100;
const PROMOTING: (keyof TableTabState)[] = [
    'filters',
    'sort',
    'page',
    'perPage',
];

const fresh = (): ConnectionBrowse => ({
    tabs: [UNIVERSE_TAB],
    activeId: 'universe',
    recents: [],
    perPage: DEFAULT_PER_PAGE,
});

const defaultState = (perPage: PerPage): TableTabState => ({
    filters: [],
    sort: [],
    page: 1,
    perPage,
    view: 'data',
    drawerRow: null,
});

type Actions = {
    get: (connectionId: WorkspaceRef) => ConnectionBrowse;
    openTable: (
        connectionId: WorkspaceRef,
        table: string,
        opts?: {
            mode?: OpenMode;
            state?: Partial<TableTabState>;
            /** Merge `state` into an existing tab's state instead of replacing it (filtered opens replace). */
            merge?: boolean;
        },
    ) => string;
    /** A copy of a table tab (drawer closed, never a preview) right after it, activated; '' when `id` is no table tab. */
    duplicateTab: (connectionId: WorkspaceRef, id: string) => string;
    /** A further tab of `table` with default state, permanent, after the active tab, activated. */
    openNewView: (connectionId: WorkspaceRef, table: string) => string;
    promote: (connectionId: WorkspaceRef, id: string) => void;
    activate: (connectionId: WorkspaceRef, id: string) => void;
    activateIndex: (connectionId: WorkspaceRef, n: number) => void;
    cycle: (connectionId: WorkspaceRef, dir: 1 | -1) => void;
    closeTab: (connectionId: WorkspaceRef, id: string) => void;
    closeOthers: (connectionId: WorkspaceRef, id: string) => void;
    closeRight: (connectionId: WorkspaceRef, id: string) => void;
    closeAll: (connectionId: WorkspaceRef) => void;
    move: (connectionId: WorkspaceRef, id: string, toIndex: number) => void;
    updateTable: (
        connectionId: WorkspaceRef,
        id: string,
        patch: Partial<TableTabState>,
    ) => void;
    showRecords: (connectionId: WorkspaceRef, title: string) => void;
    closeRecords: (connectionId: WorkspaceRef) => void;
    reconcile: (
        connectionId: WorkspaceRef,
        tables: Map<string, string[]>,
    ) => { dropped: string[]; cleaned: string[] };
};

type State = { byConnection: Record<WorkspaceRef, ConnectionBrowse> } & Actions;

/**
 * Asked before tabs close (or a preview is replaced) that leave `tables` with no open view. Returning true holds
 * the close: the guard calls `proceed` itself once the user agrees (staged editing asks before pending changes of
 * such a table are discarded, spec §4.4). False lets the close go ahead now.
 */
export type CloseGuard = (
    connectionId: WorkspaceRef,
    tables: string[],
    proceed: () => void,
) => boolean;

let closeGuard: CloseGuard | null = null;
/** True while a held close runs after the guard agreed: it is not asked again. */
let unguarded = false;

export function setCloseGuard(guard: CloseGuard | null): void {
    closeGuard = guard;
}

/** Runs `run` unless the guard holds it; whether it ran now. */
function guarded(
    connectionId: WorkspaceRef,
    tables: string[],
    run: () => void,
): boolean {
    if (
        unguarded ||
        tables.length === 0 ||
        !closeGuard?.(connectionId, tables, () => {
            unguarded = true;
            try {
                run();
            } finally {
                unguarded = false;
            }
        })
    ) {
        run();
        return true;
    }
    return false;
}

/** The tables shown by tabs of `before` that are not kept, and by none that are. */
function lastViewsClosed(before: BrowseTab[], kept: BrowseTab[]): string[] {
    const left = new Set(kept.filter(isTable).map((t) => t.table));
    return [
        ...new Set(
            before
                .filter((t): t is TableTab => isTable(t) && !kept.includes(t))
                .map((t) => t.table),
        ),
    ].filter((t) => !left.has(t));
}

/** After removing tabs, the active one is kept if it survives, else its right neighbour, else its left. */
function afterRemoval(
    before: BrowseTab[],
    after: BrowseTab[],
    activeId: string,
): string {
    if (after.some((t) => t.id === activeId)) return activeId;
    const index = before.findIndex((t) => t.id === activeId);
    for (let i = index + 1; i < before.length; i++)
        if (after.some((t) => t.id === before[i].id)) return before[i].id;
    for (let i = index - 1; i >= 0; i--)
        if (after.some((t) => t.id === before[i].id)) return before[i].id;
    return 'universe';
}

const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object';
const isFilter = (f: unknown): f is RowFilter =>
    isObj(f) &&
    typeof f.column === 'string' &&
    typeof f.op === 'string' &&
    (f.value === undefined || typeof f.value === 'string') &&
    (f.to === undefined || typeof f.to === 'string');
const isSortKey = (s: unknown): s is SortKey =>
    isObj(s) &&
    typeof s.column === 'string' &&
    (s.direction === 'asc' || s.direction === 'desc');
const isPerPage = (n: unknown): n is PerPage =>
    (PER_PAGE_OPTIONS as readonly unknown[]).includes(n);

function sanitizeTab(t: unknown, perPage: PerPage): BrowseTab | null {
    if (!isObj(t)) return null;
    if (t.kind === 'records' && typeof t.title === 'string')
        return { id: 'records', kind: 'records', title: t.title };
    if (
        t.kind !== 'table' ||
        typeof t.table !== 'string' ||
        t.table === '' ||
        typeof t.id !== 'string' ||
        !TAB_ID.test(t.id)
    )
        return null;
    const s = isObj(t.state) ? t.state : {};
    return {
        id: t.id,
        kind: 'table',
        table: t.table,
        // Checked against the other tabs of the table by sanitize().
        ordinal:
            Number.isInteger(t.ordinal) && (t.ordinal as number) >= 1
                ? (t.ordinal as number)
                : 0,
        activatedAt:
            Number.isFinite(t.activatedAt) && (t.activatedAt as number) >= 0
                ? (t.activatedAt as number)
                : 0,
        preview: t.preview === true,
        state: {
            filters: Array.isArray(s.filters)
                ? s.filters.filter(isFilter).slice(0, 20)
                : [],
            sort: Array.isArray(s.sort)
                ? s.sort.filter(isSortKey).slice(0, 3)
                : [],
            page:
                Number.isInteger(s.page) && (s.page as number) >= 1
                    ? (s.page as number)
                    : 1,
            perPage: isPerPage(s.perPage) ? s.perPage : perPage,
            view: s.view === 'structure' ? 'structure' : 'data',
            drawerRow: null,
        },
    };
}

function sanitize(input: unknown): Record<WorkspaceRef, ConnectionBrowse> {
    const out: Record<WorkspaceRef, ConnectionBrowse> = {};
    if (!isObj(input)) return out;
    for (const [key, value] of Object.entries(input)) {
        if (!isObj(value) || !isWorkspaceRef(key)) continue;
        const perPage = isPerPage(value.perPage)
            ? value.perPage
            : DEFAULT_PER_PAGE;
        const seen = new Set<string>();
        const tabs: BrowseTab[] = [UNIVERSE_TAB];
        for (const raw of Array.isArray(value.tabs)
            ? value.tabs.slice(0, 50)
            : []) {
            const tab = sanitizeTab(raw, perPage);
            if (!tab || seen.has(tab.id)) continue;
            seen.add(tab.id);
            if (
                tab.kind === 'table' &&
                (tab.ordinal === 0 ||
                    tabs.some(
                        (t) =>
                            isTable(t) &&
                            t.table === tab.table &&
                            t.ordinal === tab.ordinal,
                    ))
            )
                tab.ordinal = nextOrdinal(tabs, tab.table);
            tabs.push(tab);
        }
        const recents = Array.isArray(value.recents)
            ? value.recents
                  .filter((r): r is string => typeof r === 'string')
                  .slice(0, MAX_RECENTS)
            : [];
        const activeId = tabs.some((t) => t.id === value.activeId)
            ? (value.activeId as string)
            : 'universe';
        out[key] = { tabs, activeId, recents, perPage };
    }
    return out;
}

/**
 * Version 1 had one tab per table, id `t:<table>`. Each becomes a view: a fresh id, ordinal 1, activation in tab
 * order (the active tab latest), and the active id follows. Anything malformed is passed on for sanitize() to drop.
 *
 * A blob labelled version 1 may still hold version-2 connections: a window running older code copies the other
 * connections verbatim when it saves its own. Tabs that are already views (a non-legacy id and an ordinal) pass
 * through untouched, and only a legacy active id is remapped. Two windows running this code that migrate the same
 * legacy blob mint different ids; the later write wins and the other window takes it over on its storage-event
 * rehydrate, so they converge.
 */
function migrateConnections(input: unknown): unknown {
    if (!isObj(input)) return input;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        if (!isObj(value) || !Array.isArray(value.tabs)) {
            out[key] = value;
            continue;
        }
        const ids = new Map<unknown, string>();
        const tables = new Set<string>();
        const raw: unknown[] = value.tabs;
        const tabs = raw.flatMap((t, i) => {
            if (!isObj(t) || t.kind !== 'table') return [t];
            if (typeof t.table !== 'string') return [];
            const isView =
                typeof t.id === 'string' &&
                TAB_ID.test(t.id) &&
                t.id !== `t:${t.table}` &&
                Number.isInteger(t.ordinal);
            if (isView) return [t];
            if (tables.has(t.table)) return [];
            tables.add(t.table);
            const id = newTabId();
            // Version 1 always named a table tab `t:<table>`, whatever id was stored.
            const old = `t:${t.table}`;
            ids.set(old, id);
            return [
                {
                    ...t,
                    id,
                    ordinal: 1,
                    activatedAt: old === value.activeId ? raw.length : i,
                },
            ];
        });
        out[key] = {
            ...value,
            tabs,
            activeId: ids.get(value.activeId) ?? value.activeId,
        };
    }
    return out;
}

const STORAGE_KEY = 'dbsuperb.browse';
const VERSION = 2;
const PERSIST_DELAY_MS = 250;

type Persisted = { byConnection: Record<WorkspaceRef, ConnectionBrowse> };

let pendingWrite: (() => void) | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/** Writes any debounced change now. */
export function flushBrowse(): void {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = null;
    const write = pendingWrite;
    pendingWrite = null;
    write?.();
}

/** The map as last read from or written to storage, to tell which connections this browser tab changed. */
let lastSynced: Record<WorkspaceRef, ConnectionBrowse> = {};

/**
 * Another browser tab may have saved its workspace since this one loaded, so a write replaces only the connections
 * changed here and keeps the rest of what is stored. Writes are debounced so rapid filter and page changes do not
 * serialise on every update; corrupt JSON reads as empty.
 */
const browseStorage: PersistStorage<Persisted> = {
    getItem: (name) => {
        const raw = safeStorage.getItem(name);
        if (!raw) return null;
        try {
            const parsed: unknown = JSON.parse(raw);
            if (!isObj(parsed)) return null;
            // zustand migrates only numbered versions; an unversioned blob is as old as they come.
            return typeof parsed.version === 'number'
                ? (parsed as StorageValue<Persisted>)
                : ({ ...parsed, version: 0 } as StorageValue<Persisted>);
        } catch {
            return null;
        }
    },
    setItem: (name, value) => {
        pendingWrite = () => writeMerged(name, value);
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(flushBrowse, PERSIST_DELAY_MS);
    },
    removeItem: (name) => safeStorage.removeItem(name),
};

function writeMerged(
    name: string,
    value: { state: Persisted; version?: number },
) {
    const next = value.state.byConnection;
    const stored = browseStorage.getItem(name) as {
        state?: { byConnection?: unknown };
        version?: number;
    } | null;
    // Saved by an older version: what this window holds is already migrated, so all of it is written.
    const outdated = !!stored && (stored.version ?? 0) < VERSION;
    const base = outdated
        ? migrateConnections(stored.state?.byConnection)
        : stored?.state?.byConnection;
    const merged: Record<string, unknown> = { ...(isObj(base) ? base : {}) };
    const ids = new Set([...Object.keys(next), ...Object.keys(lastSynced)]);
    for (const key of ids) {
        if (next[key] === lastSynced[key] && !outdated) continue;
        if (next[key]) merged[key] = next[key];
        else delete merged[key];
    }
    lastSynced = next;
    safeStorage.setItem(
        name,
        JSON.stringify({ ...value, state: { byConnection: merged } }),
    );
}

/** Stored and local workspaces are the same when they serialise alike once sanitised (the drawer is never stored). */
const sameStored = (a: ConnectionBrowse, b: ConnectionBrowse) =>
    JSON.stringify(sanitize({ 0: a })[0]) === JSON.stringify(b);

export const useBrowse = create<State>()(
    persist(
        (set, get) => {
            const current = (connectionId: WorkspaceRef) =>
                get().byConnection[connectionId] ?? fresh();
            const update = (
                connectionId: WorkspaceRef,
                fn: (c: ConnectionBrowse) => ConnectionBrowse,
            ) =>
                set((s) => ({
                    byConnection: {
                        ...s.byConnection,
                        [connectionId]: fn(
                            s.byConnection[connectionId] ?? fresh(),
                        ),
                    },
                }));
            const remove = (
                connectionId: WorkspaceRef,
                keep: (t: BrowseTab, i: number) => boolean,
            ) => {
                const before = current(connectionId).tabs;
                const kept = before.filter(
                    (t, i) => t.kind === 'universe' || keep(t, i),
                );
                // By id: a close held by the guard closes the tabs chosen now, even if tabs moved or opened meanwhile.
                const ids = new Set(
                    before.filter((t) => !kept.includes(t)).map((t) => t.id),
                );
                guarded(connectionId, lastViewsClosed(before, kept), () =>
                    removeNow(connectionId, (t) => !ids.has(t.id)),
                );
            };
            const removeNow = (
                connectionId: WorkspaceRef,
                keep: (t: BrowseTab, i: number) => boolean,
            ) =>
                update(connectionId, (c) => {
                    const tabs = c.tabs.filter(
                        (t, i) => t.kind === 'universe' || keep(t, i),
                    );
                    // Closed tabs' rows would only hold LRU slots.
                    for (const t of c.tabs)
                        if (isTable(t) && !tabs.includes(t))
                            rowsCache.delete(`${connectionId}:${t.id}`);
                    return focus(
                        { ...c, tabs },
                        afterRemoval(c.tabs, tabs, c.activeId),
                    );
                });
            /** Puts a new table tab after the tab at index `at(c)` and activates it. */
            const insertAfter = (
                connectionId: WorkspaceRef,
                at: (c: ConnectionBrowse) => number,
                make: (c: ConnectionBrowse) => TableTab,
            ) => {
                let id = '';
                update(connectionId, (c) => {
                    const tab = make(c);
                    id = tab.id;
                    const tabs = [...c.tabs];
                    tabs.splice(at(c) + 1, 0, tab);
                    return focus({ ...c, tabs }, tab.id);
                });
                return id;
            };

            const openNow = (
                connectionId: WorkspaceRef,
                table: string,
                opts: Parameters<Actions['openTable']>[2] = {},
            ): string => {
                const mode = opts.mode ?? 'preview';
                let id = '';
                update(connectionId, (c) => {
                    const recents = [
                        table,
                        ...c.recents.filter((r) => r !== table),
                    ].slice(0, MAX_RECENTS);
                    const existing = latestOf(c.tabs, table);
                    id = existing?.id ?? newTabId();
                    let tabs: BrowseTab[];
                    if (existing) {
                        tabs = c.tabs.map((t) =>
                            t.id === id && t.kind === 'table'
                                ? {
                                      ...t,
                                      preview: t.preview && mode === 'preview',
                                      state: !opts.state
                                          ? t.state
                                          : opts.merge
                                            ? { ...t.state, ...opts.state }
                                            : {
                                                  ...defaultState(
                                                      t.state.perPage,
                                                  ),
                                                  ...opts.state,
                                              },
                                  }
                                : t,
                        );
                    } else {
                        const tab: TableTab = {
                            id,
                            kind: 'table',
                            table,
                            ordinal: nextOrdinal(c.tabs, table),
                            activatedAt: nextStamp(c.tabs),
                            preview: mode === 'preview',
                            state: {
                                ...defaultState(c.perPage),
                                ...opts.state,
                            },
                        };
                        const previewIndex =
                            mode === 'preview'
                                ? c.tabs.findIndex(
                                      (t) => t.kind === 'table' && t.preview,
                                  )
                                : -1;
                        if (previewIndex >= 0) {
                            // The replaced preview is gone, like a closed tab: its rows would only hold an LRU slot.
                            rowsCache.delete(
                                `${connectionId}:${c.tabs[previewIndex].id}`,
                            );
                            tabs = c.tabs.map((t, i) =>
                                i === previewIndex ? tab : t,
                            );
                        } else {
                            const activeIndex = c.tabs.findIndex(
                                (t) => t.id === c.activeId,
                            );
                            tabs = [...c.tabs];
                            tabs.splice(activeIndex + 1, 0, tab);
                        }
                    }
                    const next = { ...c, tabs, recents };
                    return mode === 'background' ? next : focus(next, id);
                });
                return id;
            };

            return {
                byConnection: {},
                get: current,
                openTable: (connectionId, table, opts = {}) => {
                    // A preview that replaces the last view of its table closes that view.
                    const c = current(connectionId);
                    const replaced =
                        (opts.mode ?? 'preview') === 'preview' &&
                        !latestOf(c.tabs, table)
                            ? c.tabs.find(
                                  (t): t is TableTab => isTable(t) && t.preview,
                              )
                            : undefined;
                    const closing =
                        replaced &&
                        !c.tabs.some(
                            (t) =>
                                isTable(t) &&
                                t !== replaced &&
                                t.table === replaced.table,
                        )
                            ? [replaced.table]
                            : [];
                    let id = '';
                    const ran = guarded(connectionId, closing, () => {
                        // Held, then the preview went or changed meanwhile: the replacement asked about is moot.
                        if (
                            unguarded &&
                            replaced &&
                            !current(connectionId).tabs.some(
                                (t) =>
                                    t.id === replaced.id &&
                                    isTable(t) &&
                                    t.preview &&
                                    t.table === replaced.table,
                            )
                        )
                            return;
                        id = openNow(connectionId, table, opts);
                    });
                    return ran ? id : '';
                },
                duplicateTab: (connectionId, id) => {
                    const source = current(connectionId).tabs.find(
                        (t) => t.id === id,
                    );
                    if (!source || !isTable(source)) return '';
                    return insertAfter(
                        connectionId,
                        (c) => c.tabs.findIndex((t) => t.id === id),
                        (c) => ({
                            id: newTabId(),
                            kind: 'table',
                            table: source.table,
                            ordinal: nextOrdinal(c.tabs, source.table),
                            activatedAt: 0,
                            preview: false,
                            state: { ...source.state, drawerRow: null },
                        }),
                    );
                },
                openNewView: (connectionId, table) =>
                    insertAfter(
                        connectionId,
                        // Never before the Universe tab, even when the active id is stale.
                        (c) =>
                            Math.max(
                                0,
                                c.tabs.findIndex((t) => t.id === c.activeId),
                            ),
                        (c) => ({
                            id: newTabId(),
                            kind: 'table',
                            table,
                            ordinal: nextOrdinal(c.tabs, table),
                            activatedAt: 0,
                            preview: false,
                            state: defaultState(c.perPage),
                        }),
                    ),
                promote: (connectionId, id) => {
                    const tab = current(connectionId).tabs.find(
                        (t) => t.id === id,
                    );
                    if (tab?.kind !== 'table' || !tab.preview) return;
                    update(connectionId, (c) => ({
                        ...c,
                        tabs: c.tabs.map((t) =>
                            t.id === id && t.kind === 'table'
                                ? { ...t, preview: false }
                                : t,
                        ),
                    }));
                },
                activate: (connectionId, id) =>
                    update(connectionId, (c) => focus(c, id)),
                activateIndex: (connectionId, n) =>
                    update(connectionId, (c) =>
                        c.tabs[n] ? focus(c, c.tabs[n].id) : c,
                    ),
                cycle: (connectionId, dir) =>
                    update(connectionId, (c) => {
                        const i = c.tabs.findIndex((t) => t.id === c.activeId);
                        return focus(
                            c,
                            c.tabs[(i + dir + c.tabs.length) % c.tabs.length]
                                .id,
                        );
                    }),
                closeTab: (connectionId, id) =>
                    remove(connectionId, (t) => t.id !== id),
                closeOthers: (connectionId, id) =>
                    remove(connectionId, (t) => t.id === id),
                closeRight: (connectionId, id) => {
                    const index = current(connectionId).tabs.findIndex(
                        (t) => t.id === id,
                    );
                    remove(connectionId, (_t, i) => i <= index);
                },
                closeAll: (connectionId) => remove(connectionId, () => false),
                move: (connectionId, id, toIndex) =>
                    update(connectionId, (c) => {
                        const tab = c.tabs.find((t) => t.id === id);
                        if (!tab || tab.kind === 'universe') return c;
                        const rest = c.tabs.filter(
                            (t) => t.id !== id && t.kind !== 'universe',
                        );
                        rest.splice(
                            Math.max(0, Math.min(toIndex, rest.length)),
                            0,
                            tab,
                        );
                        return { ...c, tabs: [UNIVERSE_TAB, ...rest] };
                    }),
                updateTable: (connectionId, id, patch) =>
                    update(connectionId, (c) => {
                        const promotes =
                            PROMOTING.some((k) => k in patch) ||
                            patch.drawerRow != null;
                        return {
                            ...c,
                            perPage: patch.perPage ?? c.perPage,
                            tabs: c.tabs.map((t) =>
                                t.id === id && t.kind === 'table'
                                    ? {
                                          ...t,
                                          preview: t.preview && !promotes,
                                          state: { ...t.state, ...patch },
                                      }
                                    : t,
                            ),
                        };
                    }),
                showRecords: (connectionId, title) =>
                    update(connectionId, (c) => {
                        const has = c.tabs.some((t) => t.id === 'records');
                        const tab: BrowseTab = {
                            id: 'records',
                            kind: 'records',
                            title,
                        };
                        if (has)
                            return {
                                ...c,
                                tabs: c.tabs.map((t) =>
                                    t.id === 'records' ? tab : t,
                                ),
                                activeId: 'records',
                            };
                        const activeIndex = c.tabs.findIndex(
                            (t) => t.id === c.activeId,
                        );
                        const tabs = [...c.tabs];
                        tabs.splice(activeIndex + 1, 0, tab);
                        return { ...c, tabs, activeId: 'records' };
                    }),
                closeRecords: (connectionId) =>
                    remove(connectionId, (t) => t.id !== 'records'),
                reconcile: (connectionId, tables) => {
                    const dropped: string[] = [];
                    const cleaned: string[] = [];
                    update(connectionId, (c) => ({
                        ...c,
                        recents: c.recents.filter((r) => tables.has(r)),
                        tabs: c.tabs.map((t) => {
                            if (t.kind !== 'table') return t;
                            const columns = tables.get(t.table);
                            if (!columns) {
                                dropped.push(t.table);
                                return t;
                            }
                            const filters = t.state.filters.filter((f) =>
                                columns.includes(f.column),
                            );
                            const sort = t.state.sort.filter((s) =>
                                columns.includes(s.column),
                            );
                            if (
                                filters.length === t.state.filters.length &&
                                sort.length === t.state.sort.length
                            )
                                return t;
                            cleaned.push(t.table);
                            return {
                                ...t,
                                state: {
                                    ...t.state,
                                    filters,
                                    sort,
                                    page: 1,
                                    drawerRow: null,
                                },
                            };
                        }),
                    }));
                    return { dropped, cleaned };
                },
            };
        },
        {
            name: STORAGE_KEY,
            version: VERSION,
            storage: browseStorage,
            migrate: (persisted, version) => {
                const state = isObj(persisted) ? persisted : {};
                return (
                    (version ?? 0) < 2
                        ? {
                              ...state,
                              byConnection: migrateConnections(
                                  state.byConnection,
                              ),
                          }
                        : state
                ) as Persisted;
            },
            partialize: (s) => ({ byConnection: s.byConnection }),
            merge: (persisted, current) => {
                const incoming = sanitize(
                    (persisted as { byConnection?: unknown } | null)
                        ?.byConnection,
                );
                const byConnection = { ...incoming };
                for (const [key, local] of Object.entries(
                    current.byConnection,
                )) {
                    const stored = incoming[key];
                    if (!stored) continue;
                    if (sameStored(local, stored)) {
                        // Unchanged elsewhere: keep this window's objects (and its open drawer).
                        byConnection[key] = local;
                        incoming[key] = local;
                    } else if (stored.tabs.some((t) => t.id === local.activeId))
                        // Another window may have switched its active tab; this window keeps the one it is looking at.
                        byConnection[key] = {
                            ...stored,
                            activeId: local.activeId,
                        };
                }
                lastSynced = incoming;
                return { ...current, byConnection };
            },
        },
    ),
);

/** The active tab of a connection (Universe when none). */
export function useActiveTab(connectionId: WorkspaceRef): BrowseTab {
    return useBrowse((s) => {
        const c = s.byConnection[connectionId];
        return c?.tabs.find((t) => t.id === c.activeId) ?? UNIVERSE_TAB;
    });
}

if (typeof window !== 'undefined') {
    // A workspace saved by another browser tab replaces this tab's copy; ours is written first so it is not lost.
    window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY) return;
        flushBrowse();
        void useBrowse.persist.rehydrate();
    });
    window.addEventListener('pagehide', flushBrowse);
}
