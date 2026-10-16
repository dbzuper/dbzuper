import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { SchemaSnapshot } from '@/types/schema';
import { useActiveTab, useBrowse } from './browse-store';

const PARAM = 'tab';
const BASE = 'http://h';

/** The table named by `?tab=` in a query string, or null when absent or empty. */
export function readTabParam(search: string): string | null {
    const value = new URLSearchParams(search).get(PARAM);
    return value === null || value === '' ? null : value;
}

/** `url` (path, query and hash) with `?tab=` set to `table`, or removed when null; other params are kept. */
export function withTabParam(url: string, table: string | null): string {
    const next = new URL(url, BASE);
    if (table === null) next.searchParams.delete(PARAM);
    else next.searchParams.set(PARAM, table);
    return next.pathname + next.search + next.hash;
}

/** Rewrites the current entry in place, keeping Inertia's history.state. */
function writeTab(table: string | null) {
    const current =
        window.location.pathname +
        window.location.search +
        window.location.hash;
    const next = withTabParam(current, table);
    if (next !== current)
        window.history.replaceState(window.history.state, '', next);
}

/**
 * Keeps the active table tab in `?tab=`: once the snapshot is loaded the param opens its table (or is
 * dropped with a toast when the table is unknown); afterwards every change of the active tab rewrites
 * it, and a Universe or records tab removes it (records keep their own `?r=`).
 */
export function useBrowseUrl(
    connectionId: number,
    snapshot: SchemaSnapshot | null,
): void {
    const active = useActiveTab(connectionId);
    const activeTable = active.kind === 'table' ? active.table : null;
    // The connection whose `?tab=` has been read; writes wait for it so the param is not lost first.
    const restored = useRef<number | null>(null);

    useEffect(() => {
        if (!snapshot || restored.current === connectionId) return;
        restored.current = connectionId;
        const name = readTabParam(window.location.search);
        if (name === null) return;
        if (snapshot.tables.some((t) => t.name === name)) {
            useBrowse
                .getState()
                .openTable(connectionId, name, { mode: 'permanent' });
        } else {
            writeTab(null);
            toast.error(`Table not found: ${name}`);
        }
    }, [connectionId, snapshot]);

    useEffect(() => {
        if (restored.current !== connectionId) return;
        // Read from the store: a restore in this same commit has already changed the active tab.
        const c = useBrowse.getState().byConnection[connectionId];
        const tab = c?.tabs.find((t) => t.id === c.activeId);
        writeTab(tab?.kind === 'table' ? tab.table : null);
    }, [connectionId, activeTable, snapshot]);
}
