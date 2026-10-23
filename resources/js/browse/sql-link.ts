import type * as Monaco from 'monaco-editor';
import { useSqlTabs, type SqlLink } from '@/sql/tabs-store';
import type { Dialect } from '@/types/schema';
import { useWorkspace } from '@/universe/store';
import { tabTitle, useBrowse, type TableTab } from './browse-store';
import type { MatchedState } from './match-table-query';
import { rowsCache, rowsRequestKey } from './rows-cache';
import { buildTableSql, type TableColumns } from './table-query-sql';

/**
 * Editor tabs linked to table tabs (spec 4): the table tab's query flows into the editor, and a fitting statement
 * run in the editor sets the table tab. The browse store knows nothing of this; the dependency runs
 * browse-store ← sql-link → tabs-store.
 */

/** The parts of a Monaco text model the sync uses. */
export type EditorModel = Pick<
    Monaco.editor.ITextModel,
    | 'getFullModelRange'
    | 'pushEditOperations'
    | 'pushStackElement'
    | 'isDisposed'
    | 'onWillDispose'
>;

/** Monaco models of editor tabs, by tab id, while they exist. */
const models = new Map<string, EditorModel>();
const watched = new WeakSet<EditorModel>();

/** Makes `model` the one the sync edits for editor tab `tabId`, until it is disposed or unregistered. */
export function registerEditorModel(tabId: string, model: EditorModel): void {
    models.set(tabId, model);
    if (watched.has(model)) return;
    watched.add(model);
    model.onWillDispose(() => {
        for (const [id, m] of models) if (m === model) models.delete(id);
    });
}

export function unregisterEditorModel(
    tabId: string,
    model?: EditorModel,
): void {
    if (!model || models.get(tabId) === model) models.delete(tabId);
}

/**
 * Sets an editor tab's text. With its model in Monaco the change is an undoable edit (Ctrl+Z brings the old text
 * back); the stored text changes either way.
 */
function replaceText(connectionId: number, tabId: string, sql: string): void {
    const model = models.get(tabId);
    if (model && !model.isDisposed()) {
        model.pushStackElement();
        model.pushEditOperations(
            [],
            [{ range: model.getFullModelRange(), text: sql }],
            () => null,
        );
        model.pushStackElement();
    }
    useSqlTabs.getState().setSql(connectionId, tabId, sql);
}

const tabKey = (connectionId: number, browseTabId: string) =>
    `${connectionId}:${browseTabId}`;
/**
 * Per table tab, in this window only: the last query its rows carried and the request they answered, for
 * "Update SQL". Whether a response is new is decided by the request key saved on the link, never by this.
 */
const lastSql = new Map<string, { requestKey?: string; sql: string }>();

function tableTab(connectionId: number, id: string): TableTab | undefined {
    const tab = useBrowse
        .getState()
        .byConnection[connectionId]?.tabs.find((t) => t.id === id);
    return tab?.kind === 'table' ? tab : undefined;
}

/** Replaces an editor tab's link with `link` minus its unset fields. */
function saveLink(connectionId: number, tabId: string, link: SqlLink): void {
    const next = { ...link };
    if (!next.stale) delete next.stale;
    if (!next.closed) delete next.closed;
    if (next.requestKey === undefined) delete next.requestKey;
    useSqlTabs.getState().setLink(connectionId, tabId, next);
}

/**
 * The tab's current query: the server's SQL when it is known for the tab's current request (`requestKey` set),
 * else one built from its filters, sort and page that maps back to the same state.
 */
function currentQuery(
    connectionId: number,
    tab: TableTab,
    dialect: Dialect,
    columns: TableColumns,
): { sql: string; requestKey?: string } {
    const requestKey = rowsRequestKey(tab.state);
    const hit = rowsCache.get(tabKey(connectionId, tab.id));
    if (hit && hit.requestKey === requestKey)
        return { sql: hit.rows.sql, requestKey };
    const known = lastSql.get(tabKey(connectionId, tab.id));
    if (known && known.requestKey === requestKey)
        return { sql: known.sql, requestKey };
    return { sql: buildTableSql(dialect, tab.table, tab.state, columns) };
}

/** The tab's current query (Copy SELECT, Open in SQL). */
export function tableTabSql(
    connectionId: number,
    tab: TableTab,
    dialect: Dialect,
    columns: TableColumns,
): string {
    return currentQuery(connectionId, tab, dialect, columns).sql;
}

/**
 * "Open in SQL" on a table tab: its linked editor tab, activated, or a new one with the tab's query. The table tab
 * becomes permanent, so the next preview does not replace it and end the link.
 */
export function openTableTabInSql(
    connectionId: number,
    tab: TableTab,
    dialect: Dialect,
    columns: TableColumns,
): string {
    useBrowse.getState().promote(connectionId, tab.id);
    const { sql, requestKey } = currentQuery(
        connectionId,
        tab,
        dialect,
        columns,
    );
    return useSqlTabs
        .getState()
        .openLinkedTab(
            connectionId,
            tab.id,
            tab.table,
            tabTitle(tab),
            sql,
            requestKey,
        );
}

/** The table tab's latest query as last reported, else from its cached rows; undefined when unknown. */
export function latestTableSql(
    connectionId: number,
    browseTabId: string,
): string | undefined {
    const tab = tableTab(connectionId, browseTabId);
    const current = tab ? rowsRequestKey(tab.state) : undefined;
    const known = lastSql.get(tabKey(connectionId, browseTabId));
    if (
        known &&
        (known.requestKey === undefined || known.requestKey === current)
    )
        return known.sql;
    const hit = rowsCache.get(tabKey(connectionId, browseTabId));
    return hit && hit.requestKey === current ? hit.rows.sql : undefined;
}

/**
 * The table tab's query is now `sql` (answering `requestKey`, when given). Its linked editor tab follows when its
 * text is unedited (still `syncedSql`); edited text is never touched, the link goes stale instead. A query back at
 * `syncedSql` is in step again.
 */
export function onTableQuery(
    connectionId: number,
    browseTabId: string,
    sql: string,
    requestKey?: string,
): void {
    lastSql.set(tabKey(connectionId, browseTabId), { requestKey, sql });
    const tab = useSqlTabs.getState().findLinked(connectionId, browseTabId);
    const link = tab?.link;
    if (!tab || !link || link.closed) return;
    const base = { ...link, requestKey: requestKey ?? link.requestKey };
    let next: SqlLink;
    if (tab.sql === sql || link.syncedSql === sql)
        next = { ...base, syncedSql: sql, stale: undefined };
    else if (tab.sql === link.syncedSql) {
        replaceText(connectionId, tab.id, sql);
        next = { ...base, syncedSql: sql, stale: undefined };
    } else next = { ...base, stale: true };
    if (
        next.syncedSql !== link.syncedSql ||
        next.requestKey !== link.requestKey ||
        !next.stale !== !link.stale
    )
        saveLink(connectionId, tab.id, next);
}

/**
 * A rows response arrived for a table tab. Only a request other than the one the link last exchanged (filters,
 * sort, page or page size changed) counts as a new query; a refetch of it (Refresh, Retry, a reload, another
 * window) does not. The key is saved on the link, so this holds across reloads and windows.
 */
export function reportTableRows(
    connectionId: number,
    browseTabId: string,
    requestKey: string,
    sql: string,
): void {
    const link = useSqlTabs
        .getState()
        .findLinked(connectionId, browseTabId)?.link;
    if (link && !link.closed && link.requestKey === requestKey) {
        lastSql.set(tabKey(connectionId, browseTabId), { requestKey, sql });
        return;
    }
    // A link opened from a built query has no request yet. The first response to the state it was built from is
    // that same query: edited text is not stale for it, the link just takes its request key.
    const table = tableTab(connectionId, browseTabId);
    const editor = useSqlTabs.getState().findLinked(connectionId, browseTabId);
    if (
        editor &&
        link &&
        !link.closed &&
        link.requestKey === undefined &&
        editor.sql !== link.syncedSql &&
        table &&
        rowsRequestKey(table.state) === requestKey
    ) {
        lastSql.set(tabKey(connectionId, browseTabId), { requestKey, sql });
        saveLink(connectionId, editor.id, { ...link, requestKey });
        return;
    }
    onTableQuery(connectionId, browseTabId, sql, requestKey);
}

/** The table tab was closed: its editor tab says so until edited, and follows nothing. */
export function onBrowseTabClosed(
    connectionId: number,
    browseTabId: string,
): void {
    lastSql.delete(tabKey(connectionId, browseTabId));
    const tab = useSqlTabs.getState().findLinked(connectionId, browseTabId);
    if (!tab?.link || tab.link.closed) return;
    saveLink(connectionId, tab.id, {
        ...tab.link,
        stale: undefined,
        closed: true,
    });
}

/**
 * Stale ("Update SQL"): the editor takes the table tab's latest query, or with `dialect` one built from its state
 * (and the table's `columns`) when no query is known. False when there is none.
 */
export function updateSqlFromTable(
    connectionId: number,
    browseTabId: string,
    dialect?: Dialect,
    columns: TableColumns = [],
): boolean {
    const tab = useSqlTabs.getState().findLinked(connectionId, browseTabId);
    const table = tableTab(connectionId, browseTabId);
    const sql =
        latestTableSql(connectionId, browseTabId) ??
        (dialect && table
            ? currentQuery(connectionId, table, dialect, columns).sql
            : undefined);
    if (!tab?.link || tab.link.closed || sql === undefined) return false;
    if (tab.sql !== sql) replaceText(connectionId, tab.id, sql);
    saveLink(connectionId, tab.id, {
        ...tab.link,
        syncedSql: sql,
        stale: undefined,
    });
    return true;
}

/**
 * Run in a linked editor tab, the statement fit the table: the table tab takes its filters, sort, page and page size
 * (keeping its page size when the statement has no LIMIT), shows its Data view and is activated. The editor text
 * (`text`, default the whole tab) becomes `syncedSql` for the applied request, so the rows that answer it are not
 * synced back over it. False (nothing applied) when the table tab is gone.
 */
export function applyToTable(
    connectionId: number,
    link: SqlLink,
    state: MatchedState,
    text?: string,
): boolean {
    const browse = useBrowse.getState();
    const target = tableTab(connectionId, link.browseTabId);
    if (!target) return false;
    const next = {
        filters: state.filters,
        sort: state.sort,
        page: state.page,
        perPage: state.perPage ?? target.state.perPage,
    };
    browse.updateTable(connectionId, link.browseTabId, {
        ...next,
        view: 'data',
        drawerRow: null,
    });
    browse.activate(connectionId, link.browseTabId);
    lastSql.delete(tabKey(connectionId, link.browseTabId));
    const tab = useSqlTabs
        .getState()
        .findLinked(connectionId, link.browseTabId);
    if (!tab?.link) return true;
    saveLink(connectionId, tab.id, {
        ...tab.link,
        syncedSql: text ?? tab.sql,
        requestKey: rowsRequestKey(next),
        stale: undefined,
    });
    return true;
}

/** Links whose table tab is gone (e.g. closed in an earlier session) are marked closed. */
export function dropDanglingLinks(): void {
    for (const [key, c] of Object.entries(useSqlTabs.getState().byConnection)) {
        const id = Number(key);
        for (const t of c.tabs)
            if (t.link && !t.link.closed && !tableTab(id, t.link.browseTabId))
                onBrowseTabClosed(id, t.link.browseTabId);
    }
}

/**
 * The tab a connection switched to when the user activated it: the active id changed while the tab active before
 * is still open. A close (its neighbour takes over) is no activation, nor is a store being rehydrated from storage
 * (another window's changes), so following stays per window.
 */
function activations<C extends { activeId: string; tabs: { id: string }[] }>(
    state: Record<number, C>,
    prev: Record<number, C>,
): [number, string][] {
    const out: [number, string][] = [];
    for (const [key, after] of Object.entries(state)) {
        const before = prev[Number(key)];
        if (!before || after === before || after.activeId === before.activeId)
            continue;
        if (!after.tabs.some((t) => t.id === before.activeId)) continue;
        out.push([Number(key), after.activeId]);
    }
    return out;
}

/** Set while one side follows the other: each follow is a single set on the other store, so suppressing the nested follow it triggers only stops the echo back. */
let following = false;

function follow(fn: () => void): void {
    if (following) return;
    following = true;
    try {
        fn();
    } finally {
        following = false;
    }
}

/** A table tab was activated: its linked editor tab becomes the dock's active tab, when the dock is open. */
function followTable(connectionId: number, browseTabId: string): void {
    if (!useWorkspace.getState().dockOpen) return;
    const editor = useSqlTabs.getState().findLinked(connectionId, browseTabId);
    if (!editor?.link || editor.link.closed) return;
    if (
        useSqlTabs.getState().byConnection[connectionId]?.activeId === editor.id
    )
        return;
    useSqlTabs.getState().setActive(connectionId, editor.id);
}

/** An editor tab was activated: its linked table tab becomes the active tab of the main area. */
function followEditor(connectionId: number, tabId: string): void {
    const link = useSqlTabs
        .getState()
        .byConnection[connectionId]?.tabs.find((t) => t.id === tabId)?.link;
    if (!link || link.closed || !tableTab(connectionId, link.browseTabId))
        return;
    if (
        useBrowse.getState().byConnection[connectionId]?.activeId ===
        link.browseTabId
    )
        return;
    useBrowse.getState().activate(connectionId, link.browseTabId);
}

let uninstall: (() => void) | null = null;

/**
 * Watches the browse store for closed table tabs, and both stores for activations, so a linked table tab and editor
 * tab follow each other; runs once on first import, and again after a hot update.
 */
export function initSqlLink(): void {
    if (uninstall) return;
    dropDanglingLinks();
    const offBrowse = useBrowse.subscribe((state, prev) => {
        for (const [key, before] of Object.entries(prev.byConnection)) {
            const after = state.byConnection[Number(key)];
            if (after === before) continue;
            const open = new Set(after?.tabs.map((t) => t.id));
            for (const t of before.tabs)
                if (t.kind === 'table' && !open.has(t.id))
                    onBrowseTabClosed(Number(key), t.id);
        }
        if (!useBrowse.persist.hasHydrated()) return;
        for (const [id, active] of activations(
            state.byConnection,
            prev.byConnection,
        ))
            follow(() => followTable(id, active));
    });
    const offSql = useSqlTabs.subscribe((state, prev) => {
        if (!useSqlTabs.persist.hasHydrated()) return;
        for (const [id, active] of activations(
            state.byConnection,
            prev.byConnection,
        ))
            follow(() => followEditor(id, active));
    });
    uninstall = () => {
        offBrowse();
        offSql();
    };
}

initSqlLink();

if (import.meta.hot)
    import.meta.hot.dispose(() => {
        uninstall?.();
        uninstall = null;
    });
