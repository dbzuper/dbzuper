import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import {
    PER_PAGE_OPTIONS,
    type PerPage,
    type RowFilter,
    type SortKey,
} from '@/lib/workspace-api';
import { safeStorage } from './safe-storage';

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
export const tableTabId = (table: string) => `t:${table}`;

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
    get: (connectionId: number) => ConnectionBrowse;
    openTable: (
        connectionId: number,
        table: string,
        opts?: {
            mode?: OpenMode;
            state?: Partial<TableTabState>;
            /** Merge `state` into an existing tab's state instead of replacing it (filtered opens replace). */
            merge?: boolean;
        },
    ) => string;
    promote: (connectionId: number, id: string) => void;
    activate: (connectionId: number, id: string) => void;
    activateIndex: (connectionId: number, n: number) => void;
    cycle: (connectionId: number, dir: 1 | -1) => void;
    closeTab: (connectionId: number, id: string) => void;
    closeOthers: (connectionId: number, id: string) => void;
    closeRight: (connectionId: number, id: string) => void;
    closeAll: (connectionId: number) => void;
    move: (connectionId: number, id: string, toIndex: number) => void;
    updateTable: (
        connectionId: number,
        id: string,
        patch: Partial<TableTabState>,
    ) => void;
    showRecords: (connectionId: number, title: string) => void;
    closeRecords: (connectionId: number) => void;
    reconcile: (
        connectionId: number,
        tables: Map<string, string[]>,
    ) => { dropped: string[]; cleaned: string[] };
};

type State = { byConnection: Record<number, ConnectionBrowse> } & Actions;

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
    (f.value === undefined || typeof f.value === 'string');
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
    if (t.kind !== 'table' || typeof t.table !== 'string' || t.table === '')
        return null;
    const s = isObj(t.state) ? t.state : {};
    return {
        id: tableTabId(t.table),
        kind: 'table',
        table: t.table,
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

function sanitize(input: unknown): Record<number, ConnectionBrowse> {
    const out: Record<number, ConnectionBrowse> = {};
    if (!isObj(input)) return out;
    for (const [key, value] of Object.entries(input)) {
        if (!isObj(value) || !Number.isInteger(Number(key))) continue;
        const perPage = isPerPage(value.perPage)
            ? value.perPage
            : DEFAULT_PER_PAGE;
        const seen = new Set<string>();
        const tabs: BrowseTab[] = [UNIVERSE_TAB];
        for (const raw of Array.isArray(value.tabs)
            ? value.tabs.slice(0, 50)
            : []) {
            const tab = sanitizeTab(raw, perPage);
            if (tab && !seen.has(tab.id)) {
                seen.add(tab.id);
                tabs.push(tab);
            }
        }
        const recents = Array.isArray(value.recents)
            ? value.recents
                  .filter((r): r is string => typeof r === 'string')
                  .slice(0, MAX_RECENTS)
            : [];
        const activeId = tabs.some((t) => t.id === value.activeId)
            ? (value.activeId as string)
            : 'universe';
        out[Number(key)] = { tabs, activeId, recents, perPage };
    }
    return out;
}

const STORAGE_KEY = 'dbsuperb.browse';
const PERSIST_DELAY_MS = 250;

type Persisted = { byConnection: Record<number, ConnectionBrowse> };

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
let lastSynced: Record<number, ConnectionBrowse> = {};

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
            return JSON.parse(raw);
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
    const merged: Record<string, unknown> = {
        ...(
            browseStorage.getItem(name) as {
                state?: { byConnection?: Record<string, unknown> };
            } | null
        )?.state?.byConnection,
    };
    const ids = new Set([...Object.keys(next), ...Object.keys(lastSynced)]);
    for (const key of ids) {
        const id = Number(key);
        if (next[id] === lastSynced[id]) continue;
        if (next[id]) merged[key] = next[id];
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
            const current = (connectionId: number) =>
                get().byConnection[connectionId] ?? fresh();
            const update = (
                connectionId: number,
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
                connectionId: number,
                keep: (t: BrowseTab, i: number) => boolean,
            ) =>
                update(connectionId, (c) => {
                    const tabs = c.tabs.filter(
                        (t, i) => t.kind === 'universe' || keep(t, i),
                    );
                    return {
                        ...c,
                        tabs,
                        activeId: afterRemoval(c.tabs, tabs, c.activeId),
                    };
                });

            return {
                byConnection: {},
                get: current,
                openTable: (connectionId, table, opts = {}) => {
                    const mode = opts.mode ?? 'preview';
                    const id = tableTabId(table);
                    update(connectionId, (c) => {
                        const recents = [
                            table,
                            ...c.recents.filter((r) => r !== table),
                        ].slice(0, MAX_RECENTS);
                        const existing = c.tabs.find((t) => t.id === id);
                        let tabs: BrowseTab[];
                        if (existing && existing.kind === 'table') {
                            tabs = c.tabs.map((t) =>
                                t.id === id && t.kind === 'table'
                                    ? {
                                          ...t,
                                          preview:
                                              t.preview && mode === 'preview',
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
                                preview: mode === 'preview',
                                state: {
                                    ...defaultState(c.perPage),
                                    ...opts.state,
                                },
                            };
                            const previewIndex =
                                mode === 'preview'
                                    ? c.tabs.findIndex(
                                          (t) =>
                                              t.kind === 'table' && t.preview,
                                      )
                                    : -1;
                            if (previewIndex >= 0) {
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
                        return {
                            ...c,
                            tabs,
                            recents,
                            activeId: mode === 'background' ? c.activeId : id,
                        };
                    });
                    return id;
                },
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
                    update(connectionId, (c) =>
                        c.tabs.some((t) => t.id === id)
                            ? { ...c, activeId: id }
                            : c,
                    ),
                activateIndex: (connectionId, n) =>
                    update(connectionId, (c) =>
                        c.tabs[n] ? { ...c, activeId: c.tabs[n].id } : c,
                    ),
                cycle: (connectionId, dir) =>
                    update(connectionId, (c) => {
                        const i = c.tabs.findIndex((t) => t.id === c.activeId);
                        return {
                            ...c,
                            activeId:
                                c.tabs[
                                    (i + dir + c.tabs.length) % c.tabs.length
                                ].id,
                        };
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
            version: 1,
            storage: browseStorage,
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
                    const id = Number(key);
                    const stored = incoming[id];
                    if (!stored) continue;
                    if (sameStored(local, stored)) {
                        // Unchanged elsewhere: keep this window's objects (and its open drawer).
                        byConnection[id] = local;
                        incoming[id] = local;
                    } else if (stored.tabs.some((t) => t.id === local.activeId))
                        // Another window may have switched its active tab; this window keeps the one it is looking at.
                        byConnection[id] = {
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
export function useActiveTab(connectionId: number): BrowseTab {
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
