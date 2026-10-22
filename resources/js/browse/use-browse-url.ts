import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { SchemaSnapshot } from '@/types/schema';
import { useActiveTab, useBrowse } from './browse-store';

const PARAM = 'tab';
const VIEW_PARAM = 'view';
const BASE = 'http://h';

/** A table tab as the URL names it: the table and the tab's ordinal among its views (1 for the first). */
export type TabTarget = { table: string; view: number };

/** The tab named by `?tab=` (and `&view=`) in a query string, or null when `tab` is absent or empty. */
export function readTabParam(search: string): TabTarget | null {
    const params = new URLSearchParams(search);
    const table = params.get(PARAM);
    if (table === null || table === '') return null;
    const raw = params.get(VIEW_PARAM) ?? '';
    const view = /^[1-9][0-9]{0,5}$/.test(raw) ? Number(raw) : 1;
    return { table, view };
}

/**
 * `url` (path, query and hash) with `?tab=` set to the target's table and `&view=` to its ordinal from 2 (the first
 * view has none), or both removed when null; other params are kept.
 */
export function withTabParam(url: string, target: TabTarget | null): string {
    const next = new URL(url, BASE);
    if (target === null) next.searchParams.delete(PARAM);
    else next.searchParams.set(PARAM, target.table);
    if (target === null || target.view <= 1)
        next.searchParams.delete(VIEW_PARAM);
    else next.searchParams.set(VIEW_PARAM, String(target.view));
    return next.pathname + next.search + next.hash;
}

/** Rewrites the current entry in place, keeping Inertia's history.state. */
function writeTab(target: TabTarget | null) {
    const current =
        window.location.pathname +
        window.location.search +
        window.location.hash;
    const next = withTabParam(current, target);
    if (next !== current)
        window.history.replaceState(window.history.state, '', next);
}

/**
 * Keeps the active table tab in `?tab=` (`&view=` from its second view): once the snapshot is loaded the
 * params open that view, else the latest tab of the table, else a new one (or are dropped with a toast
 * when the table is unknown); afterwards every change of the active tab rewrites them, and a Universe or
 * records tab removes them (records keep their own `?r=`).
 */
export function useBrowseUrl(
    connectionId: number,
    snapshot: SchemaSnapshot | null,
): void {
    const active = useActiveTab(connectionId);
    // Ids are stable and a tab's table and ordinal never change, so the id says when to rewrite.
    const activeTableId = active.kind === 'table' ? active.id : null;
    // The connection whose `?tab=` has been read; writes wait for it so the param is not lost first.
    const restored = useRef<number | null>(null);

    useEffect(() => {
        if (!snapshot || restored.current === connectionId) return;
        restored.current = connectionId;
        const target = readTabParam(window.location.search);
        if (target === null) return;
        const name = target.table;
        if (snapshot.tables.some((t) => t.name === name)) {
            const store = useBrowse.getState();
            const view = store
                .get(connectionId)
                .tabs.find(
                    (t) =>
                        t.kind === 'table' &&
                        t.table === name &&
                        t.ordinal === target.view,
                );
            if (view) {
                store.activate(connectionId, view.id);
                store.promote(connectionId, view.id);
            } else store.openTable(connectionId, name, { mode: 'permanent' });
        } else {
            // A link to a missing table lands on the Universe tab, whatever was active before.
            useBrowse.getState().activate(connectionId, 'universe');
            writeTab(null);
            toast.error(`Table not found: ${name}`);
        }
    }, [connectionId, snapshot]);

    useEffect(() => {
        if (restored.current !== connectionId) return;
        // Read from the store: a restore in this same commit has already changed the active tab.
        const c = useBrowse.getState().byConnection[connectionId];
        const tab = c?.tabs.find((t) => t.id === c.activeId);
        writeTab(
            tab?.kind === 'table'
                ? { table: tab.table, view: tab.ordinal }
                : null,
        );
    }, [connectionId, activeTableId, snapshot]);
}
