import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import { safeStorage } from '@/browse/safe-storage';
import { isWorkspaceRef, type WorkspaceRef } from '@/types/connection';

/**
 * An editor tab opened from a table tab ("Open in SQL") follows that tab's query and can set it (spec 4).
 * `syncedSql` is the text last exchanged with the table tab: the editor text still equals it when the user has not
 * edited since. `stale`: the table changed while the text was edited. `closed`: the table tab was closed; the
 * link is kept only to say so, and ends on the next edit.
 */
export type SqlLink = {
    browseTabId: string;
    table: string;
    /** The table tab's title (`orders (2)`), kept for the chip even once the tab is closed. */
    title: string;
    syncedSql: string;
    /**
     * The table tab's rows request that `syncedSql` was last exchanged for (absent when the text was built
     * locally). Saved, so a reload or another window does not take the same request for a new one.
     */
    requestKey?: string;
    stale?: boolean;
    closed?: boolean;
};
export type SqlTab = { id: string; title: string; sql: string; link?: SqlLink };
type ConnectionTabs = { tabs: SqlTab[]; activeId: string };

type State = {
    byConnection: Record<WorkspaceRef, ConnectionTabs>;
    ensure: (connectionId: WorkspaceRef) => void;
    openTab: (
        connectionId: WorkspaceRef,
        sql?: string,
        title?: string,
    ) => string;
    closeTab: (connectionId: WorkspaceRef, id: string) => void;
    setActive: (connectionId: WorkspaceRef, id: string) => void;
    setSql: (connectionId: WorkspaceRef, id: string, sql: string) => void;
    rename: (connectionId: WorkspaceRef, id: string, title: string) => void;
    /**
     * Activates the editor tab linked to table tab `browseTabId`, or opens one titled `title` with `sql` linked to
     * it (`requestKey`: the rows request `sql` answers, when it is the server's). Returns its id.
     */
    openLinkedTab: (
        connectionId: WorkspaceRef,
        browseTabId: string,
        table: string,
        title: string,
        sql: string,
        requestKey?: string,
    ) => string;
    /** Replaces (or with undefined removes) an editor tab's link. */
    setLink: (
        connectionId: WorkspaceRef,
        id: string,
        link: SqlLink | undefined,
    ) => void;
    /** The editor tab linked to table tab `browseTabId`, if any. */
    findLinked: (
        connectionId: WorkspaceRef,
        browseTabId: string,
    ) => SqlTab | undefined;
    /** Drops the tabs of connections that no longer exist. */
    prune: (existingIds: number[]) => void;
};

/** The next "Query N": one past the highest N in use, so a closed middle tab never causes a duplicate title. */
function nextTitle(tabs: SqlTab[]): string {
    let max = 0;
    for (const t of tabs) {
        const m = /^Query (\d+)$/.exec(t.title);
        if (m) max = Math.max(max, Number(m[1]));
    }
    return `Query ${max + 1}`;
}

const newId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t${Date.now()}${Math.random()}`;

const isLink = (v: unknown): v is SqlLink => {
    if (!v || typeof v !== 'object') return false;
    const l = v as Record<string, unknown>;
    return (
        typeof l.browseTabId === 'string' &&
        typeof l.table === 'string' &&
        typeof l.syncedSql === 'string' &&
        (l.title === undefined || typeof l.title === 'string') &&
        (l.requestKey === undefined || typeof l.requestKey === 'string') &&
        (l.stale === undefined || typeof l.stale === 'boolean') &&
        (l.closed === undefined || typeof l.closed === 'boolean')
    );
};

/** A well-formed link reduced to its known fields, else undefined. */
function sanitizeLink(v: unknown): SqlLink | undefined {
    if (!isLink(v)) return undefined;
    const link: SqlLink = {
        browseTabId: v.browseTabId,
        table: v.table,
        title: v.title ?? v.table,
        syncedSql: v.syncedSql,
    };
    if (v.requestKey !== undefined) link.requestKey = v.requestKey;
    if (v.stale) link.stale = true;
    if (v.closed) link.closed = true;
    return link;
}

/** Keeps only well-formed connections: tabs present and activeId pointing at one of them. */
function sanitize(input: unknown): Record<WorkspaceRef, ConnectionTabs> {
    const out: Record<WorkspaceRef, ConnectionTabs> = {};
    if (!input || typeof input !== 'object') return out;
    for (const [key, value] of Object.entries(input)) {
        const c = value as Partial<ConnectionTabs> | null;
        if (!isWorkspaceRef(key) || !c || !Array.isArray(c.tabs)) continue;
        // One editor tab per table tab: a second link to the same table tab is dropped.
        const linked = new Set<string>();
        const tabs = c.tabs
            .filter(
                (t): t is SqlTab =>
                    !!t &&
                    typeof t.id === 'string' &&
                    typeof t.title === 'string' &&
                    typeof t.sql === 'string',
            )
            .map((t) => {
                const tab: SqlTab = { id: t.id, title: t.title, sql: t.sql };
                const link = sanitizeLink(t.link);
                if (link && !linked.has(link.browseTabId)) {
                    linked.add(link.browseTabId);
                    tab.link = link;
                }
                return tab;
            });
        if (tabs.length === 0) continue;
        out[key] = {
            tabs,
            activeId: tabs.some((t) => t.id === c.activeId)
                ? (c.activeId as string)
                : tabs[tabs.length - 1].id,
        };
    }
    return out;
}

const STORAGE_KEY = 'dbsuperb.sql-tabs';

type Persisted = { byConnection: Record<WorkspaceRef, ConnectionTabs> };

/** The map as last read from or written to storage, to tell which connections this browser tab changed. */
let lastSynced: Record<WorkspaceRef, ConnectionTabs> = {};

const PERSIST_DELAY_MS = 250;
let pendingWrite: (() => void) | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/** Writes any debounced draft changes now. */
export function flushSqlTabs(): void {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = null;
    const write = pendingWrite;
    pendingWrite = null;
    write?.();
}

/**
 * Another browser tab may have saved drafts since this one loaded, so a write replaces only the connections whose
 * tabs changed here and keeps the rest of what is stored. Writes are debounced so typing does not serialise every
 * keystroke; the latest state is what gets written.
 */
const mergingStorage: PersistStorage<Persisted> = {
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
        pendingTimer = setTimeout(flushSqlTabs, PERSIST_DELAY_MS);
    },
    removeItem: (name) => safeStorage.removeItem(name),
};

function writeMerged(
    name: string,
    value: { state: Persisted; version?: number },
) {
    {
        const next = value.state.byConnection;
        const merged: Record<string, unknown> = {
            ...(
                mergingStorage.getItem(name) as {
                    state?: { byConnection?: Record<string, unknown> };
                } | null
            )?.state?.byConnection,
        };
        const ids = new Set([...Object.keys(next), ...Object.keys(lastSynced)]);
        for (const key of ids) {
            if (next[key] === lastSynced[key]) continue;
            if (next[key]) merged[key] = next[key];
            else delete merged[key];
        }
        lastSynced = next;
        safeStorage.setItem(
            name,
            JSON.stringify({ ...value, state: { byConnection: merged } }),
        );
    }
}

export const useSqlTabs = create<State>()(
    persist(
        (set, get) => {
            const update = (
                connectionId: WorkspaceRef,
                fn: (c: ConnectionTabs) => ConnectionTabs,
            ) =>
                set((s) => {
                    const current =
                        s.byConnection[connectionId] ??
                        (() => {
                            const id = newId();
                            return {
                                tabs: [{ id, title: 'Query 1', sql: '' }],
                                activeId: id,
                            };
                        })();
                    return {
                        byConnection: {
                            ...s.byConnection,
                            [connectionId]: fn(current),
                        },
                    };
                });

            return {
                byConnection: {},
                ensure: (connectionId) => {
                    if (!get().byConnection[connectionId])
                        update(connectionId, (c) => c);
                },
                openTab: (connectionId, sql = '', title) => {
                    const id = newId();
                    update(connectionId, (c) => ({
                        tabs: [
                            ...c.tabs,
                            { id, title: title ?? nextTitle(c.tabs), sql },
                        ],
                        activeId: id,
                    }));
                    return id;
                },
                closeTab: (connectionId, id) =>
                    update(connectionId, (c) => {
                        const tabs = c.tabs.filter((t) => t.id !== id);
                        if (tabs.length === 0) {
                            const fresh = {
                                id: newId(),
                                title: nextTitle([]),
                                sql: '',
                            };
                            return { tabs: [fresh], activeId: fresh.id };
                        }
                        return {
                            tabs,
                            activeId:
                                c.activeId === id
                                    ? tabs[tabs.length - 1].id
                                    : c.activeId,
                        };
                    }),
                setActive: (connectionId, id) =>
                    update(connectionId, (c) => ({ ...c, activeId: id })),
                setSql: (connectionId, id, sql) =>
                    update(connectionId, (c) => ({
                        ...c,
                        tabs: c.tabs.map((t) => {
                            if (t.id !== id) return t;
                            // Editing after the table tab closed ends the link (and its "was closed" note).
                            if (t.link?.closed && sql !== t.sql) {
                                const { link: _ended, ...rest } = t;
                                return { ...rest, sql };
                            }
                            return { ...t, sql };
                        }),
                    })),
                openLinkedTab: (
                    connectionId,
                    browseTabId,
                    table,
                    title,
                    sql,
                    requestKey,
                ) => {
                    const existing = get().findLinked(
                        connectionId,
                        browseTabId,
                    );
                    // A link whose table tab was closed (an id since reused by this live table tab) is never
                    // revived or activated: its tab keeps its text, drops the link, and a fresh linked tab opens.
                    if (existing?.link?.closed)
                        update(connectionId, (c) => ({
                            ...c,
                            tabs: c.tabs.map((t) => {
                                if (t.id !== existing.id) return t;
                                const { link: _closed, ...rest } = t;
                                return rest;
                            }),
                        }));
                    else if (existing) {
                        update(connectionId, (c) => ({
                            tabs: c.tabs.map((t) =>
                                t.id === existing.id &&
                                t.link &&
                                t.link.title !== title
                                    ? { ...t, link: { ...t.link, title } }
                                    : t,
                            ),
                            activeId: existing.id,
                        }));
                        return existing.id;
                    }
                    const link: SqlLink = {
                        browseTabId,
                        table,
                        title,
                        syncedSql: sql,
                    };
                    if (requestKey !== undefined) link.requestKey = requestKey;
                    const id = newId();
                    update(connectionId, (c) => ({
                        tabs: [
                            ...c.tabs,
                            {
                                id,
                                title,
                                sql,
                                link,
                            },
                        ],
                        activeId: id,
                    }));
                    return id;
                },
                setLink: (connectionId, id, link) =>
                    update(connectionId, (c) =>
                        // One editor tab per table tab: a link to a table tab another editor tab follows is refused.
                        link &&
                        c.tabs.some(
                            (t) =>
                                t.id !== id &&
                                t.link?.browseTabId === link.browseTabId,
                        )
                            ? c
                            : {
                                  ...c,
                                  tabs: c.tabs.map((t) => {
                                      if (t.id !== id) return t;
                                      const { link: _old, ...rest } = t;
                                      return link ? { ...rest, link } : rest;
                                  }),
                              },
                    ),
                findLinked: (connectionId, browseTabId) =>
                    get().byConnection[connectionId]?.tabs.find(
                        (t) => t.link?.browseTabId === browseTabId,
                    ),
                prune: (existingIds) =>
                    set((s) => {
                        const keep = new Set(existingIds);
                        const entries = Object.entries(s.byConnection);
                        // A ref's id is the part before any ":database".
                        const kept = entries.filter(([k]) =>
                            keep.has(Number(k.split(':')[0])),
                        );
                        if (kept.length === entries.length) return s;
                        return { byConnection: Object.fromEntries(kept) };
                    }),
                rename: (connectionId, id, title) =>
                    update(connectionId, (c) => ({
                        ...c,
                        tabs: c.tabs.map((t) =>
                            t.id === id ? { ...t, title } : t,
                        ),
                    })),
            };
        },
        {
            name: STORAGE_KEY,
            version: 1,
            storage: mergingStorage,
            migrate: (persisted) => ({
                byConnection: sanitize(
                    (persisted as { byConnection?: unknown } | null)
                        ?.byConnection,
                ),
            }),
            merge: (persisted, current) => {
                lastSynced = sanitize(
                    (persisted as { byConnection?: unknown } | null)
                        ?.byConnection,
                );
                // Another window may have switched its active tab; this window keeps the one it is looking at.
                const byConnection = { ...lastSynced };
                for (const [key, local] of Object.entries(
                    current.byConnection,
                )) {
                    const incoming = byConnection[key];
                    if (incoming?.tabs.some((t) => t.id === local.activeId))
                        byConnection[key] = {
                            ...incoming,
                            activeId: local.activeId,
                        };
                }
                return { ...current, byConnection };
            },
            partialize: (s) => ({ byConnection: s.byConnection }),
        },
    ),
);

if (typeof window !== 'undefined') {
    // Drafts saved by another browser tab replace this tab's copy; ours are written first so they are not lost.
    window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY) return;
        flushSqlTabs();
        void useSqlTabs.persist.rehydrate();
    });
    window.addEventListener('pagehide', flushSqlTabs);
}
