import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';

export type SqlTab = { id: string; title: string; sql: string };
type ConnectionTabs = { tabs: SqlTab[]; activeId: string };

type State = {
    byConnection: Record<number, ConnectionTabs>;
    ensure: (connectionId: number) => void;
    openTab: (connectionId: number, sql?: string, title?: string) => string;
    closeTab: (connectionId: number, id: string) => void;
    setActive: (connectionId: number, id: string) => void;
    setSql: (connectionId: number, id: string, sql: string) => void;
    rename: (connectionId: number, id: string, title: string) => void;
};

const newId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t${Date.now()}${Math.random()}`;

const safeStorage = {
    getItem: (name: string) => {
        try {
            return localStorage.getItem(name);
        } catch {
            return null;
        }
    },
    setItem: (name: string, value: string) => {
        try {
            localStorage.setItem(name, value);
        } catch {
            // Quota or blocked storage must never break typing.
        }
    },
    removeItem: (name: string) => {
        try {
            localStorage.removeItem(name);
        } catch {
            // ignore
        }
    },
};

/** Keeps only well-formed connections: tabs present and activeId pointing at one of them. */
function sanitize(input: unknown): Record<number, ConnectionTabs> {
    const out: Record<number, ConnectionTabs> = {};
    if (!input || typeof input !== 'object') return out;
    for (const [key, value] of Object.entries(input)) {
        const c = value as Partial<ConnectionTabs> | null;
        if (!c || !Array.isArray(c.tabs)) continue;
        const tabs = c.tabs.filter(
            (t): t is SqlTab =>
                !!t &&
                typeof t.id === 'string' &&
                typeof t.title === 'string' &&
                typeof t.sql === 'string',
        );
        if (tabs.length === 0) continue;
        out[Number(key)] = {
            tabs,
            activeId: tabs.some((t) => t.id === c.activeId)
                ? (c.activeId as string)
                : tabs[tabs.length - 1].id,
        };
    }
    return out;
}

const STORAGE_KEY = 'dbsuperb.sql-tabs';

type Persisted = { byConnection: Record<number, ConnectionTabs> };

/** The map as last read from or written to storage, to tell which connections this browser tab changed. */
let lastSynced: Record<number, ConnectionTabs> = {};

/**
 * Another browser tab may have saved drafts since this one loaded, so a write replaces only the connections whose
 * tabs changed here and keeps the rest of what is stored.
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
    },
    removeItem: (name) => safeStorage.removeItem(name),
};

export const useSqlTabs = create<State>()(
    persist(
        (set, get) => {
            const update = (
                connectionId: number,
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
                            {
                                id,
                                title: title ?? `Query ${c.tabs.length + 1}`,
                                sql,
                            },
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
                                title: 'Query 1',
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
                        tabs: c.tabs.map((t) =>
                            t.id === id ? { ...t, sql } : t,
                        ),
                    })),
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
                return { ...current, byConnection: lastSynced };
            },
            partialize: (s) => ({ byConnection: s.byConnection }),
        },
    ),
);

// Drafts saved by another browser tab replace this tab's copy.
if (typeof window !== 'undefined')
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) void useSqlTabs.persist.rehydrate();
    });
