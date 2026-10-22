import type * as Monaco from 'monaco-editor';
import { quoteIdent } from '@/grid/copy';
import { useSqlTabs, type SqlLink } from '@/sql/tabs-store';
import type { Dialect } from '@/types/schema';
import { tabTitle, useBrowse, type TableTab } from './browse-store';
import type { MatchedState } from './match-table-query';
import { rowsCache, rowsRequestKey } from './rows-cache';

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
/** Per table tab: the request key of the last rows response, and the query it carried. */
const lastKey = new Map<string, string>();
const lastSql = new Map<string, string>();

function tableTab(connectionId: number, id: string): TableTab | undefined {
    const tab = useBrowse
        .getState()
        .byConnection[connectionId]?.tabs.find((t) => t.id === id);
    return tab?.kind === 'table' ? tab : undefined;
}

/** The SQL of the cached rows when they answer the tab's current request, else a plain first-page SELECT. */
export function tableTabSql(
    connectionId: number,
    tab: TableTab,
    dialect: Dialect,
): string {
    const hit = rowsCache.get(`${connectionId}:${tab.id}`);
    return hit && hit.requestKey === rowsRequestKey(tab.state)
        ? hit.rows.sql
        : `SELECT * FROM ${quoteIdent(dialect, tab.table)} LIMIT 100`;
}

/** "Open in SQL" on a table tab: its linked editor tab, activated, or a new one with the tab's query. */
export function openTableTabInSql(
    connectionId: number,
    tab: TableTab,
    dialect: Dialect,
): string {
    return useSqlTabs
        .getState()
        .openLinkedTab(
            connectionId,
            tab.id,
            tab.table,
            tabTitle(tab),
            tableTabSql(connectionId, tab, dialect),
        );
}

/** The table tab's latest query as last reported, else from its cached rows; undefined when unknown. */
export function latestTableSql(
    connectionId: number,
    browseTabId: string,
): string | undefined {
    const known = lastSql.get(tabKey(connectionId, browseTabId));
    if (known !== undefined) return known;
    const tab = tableTab(connectionId, browseTabId);
    const hit = rowsCache.get(tabKey(connectionId, browseTabId));
    return tab && hit && hit.requestKey === rowsRequestKey(tab.state)
        ? hit.rows.sql
        : undefined;
}

/**
 * The table tab's query is now `sql`. Its linked editor tab follows when its text is unedited (still `syncedSql`);
 * edited text is never touched, the link goes stale instead.
 */
export function onTableQuery(
    connectionId: number,
    browseTabId: string,
    sql: string,
): void {
    lastSql.set(tabKey(connectionId, browseTabId), sql);
    const tab = useSqlTabs.getState().findLinked(connectionId, browseTabId);
    const link = tab?.link;
    if (!tab || !link || link.closed) return;
    const set = (next: SqlLink) =>
        useSqlTabs.getState().setLink(connectionId, tab.id, next);
    if (tab.sql === sql) {
        if (link.syncedSql !== sql || link.stale)
            set({ ...link, syncedSql: sql, stale: undefined });
        return;
    }
    // Nothing new: the editor was already given this query.
    if (link.syncedSql === sql) return;
    if (tab.sql === link.syncedSql) {
        replaceText(connectionId, tab.id, sql);
        set({ ...link, syncedSql: sql, stale: undefined });
    } else if (!link.stale) set({ ...link, stale: true });
}

/**
 * A rows response arrived for a table tab. Only a new request (filters, sort, page or page size changed) counts as
 * a new query; a refetch of the same request (Refresh, Retry) does not.
 */
export function reportTableRows(
    connectionId: number,
    browseTabId: string,
    requestKey: string,
    sql: string,
): void {
    const key = tabKey(connectionId, browseTabId);
    if (lastKey.get(key) === requestKey) {
        lastSql.set(key, sql);
        return;
    }
    lastKey.set(key, requestKey);
    onTableQuery(connectionId, browseTabId, sql);
}

/** The table tab was closed: its editor tab says so until edited, and follows nothing. */
export function onBrowseTabClosed(
    connectionId: number,
    browseTabId: string,
): void {
    const key = tabKey(connectionId, browseTabId);
    lastKey.delete(key);
    lastSql.delete(key);
    const tab = useSqlTabs.getState().findLinked(connectionId, browseTabId);
    if (!tab?.link || tab.link.closed) return;
    useSqlTabs.getState().setLink(connectionId, tab.id, {
        ...tab.link,
        stale: undefined,
        closed: true,
    });
}

/** Stale ("Update SQL"): the editor takes the table tab's latest query. False when it is not known. */
export function updateSqlFromTable(
    connectionId: number,
    browseTabId: string,
): boolean {
    const tab = useSqlTabs.getState().findLinked(connectionId, browseTabId);
    const sql = latestTableSql(connectionId, browseTabId);
    if (!tab?.link || tab.link.closed || sql === undefined) return false;
    if (tab.sql !== sql) replaceText(connectionId, tab.id, sql);
    useSqlTabs.getState().setLink(connectionId, tab.id, {
        ...tab.link,
        syncedSql: sql,
        stale: undefined,
    });
    return true;
}

/**
 * Run in a linked editor tab, the statement fit the table: the table tab takes its filters, sort, page and page size
 * (keeping its page size when the statement has no LIMIT) and is activated. The editor text (`text`, default the
 * whole tab) becomes `syncedSql`; the rows that answer the applied state are not synced back over it.
 */
export function applyToTable(
    connectionId: number,
    link: SqlLink,
    state: MatchedState,
    text?: string,
): void {
    const browse = useBrowse.getState();
    const target = tableTab(connectionId, link.browseTabId);
    if (!target) return;
    const next = {
        filters: state.filters,
        sort: state.sort,
        page: state.page,
        perPage: state.perPage ?? target.state.perPage,
    };
    browse.updateTable(connectionId, link.browseTabId, {
        ...next,
        drawerRow: null,
    });
    browse.activate(connectionId, link.browseTabId);
    const key = tabKey(connectionId, link.browseTabId);
    lastKey.set(key, rowsRequestKey(next));
    lastSql.delete(key);
    const tab = useSqlTabs
        .getState()
        .findLinked(connectionId, link.browseTabId);
    if (!tab?.link) return;
    useSqlTabs.getState().setLink(connectionId, tab.id, {
        ...tab.link,
        syncedSql: text ?? tab.sql,
        stale: undefined,
    });
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

let installed = false;

/** Watches the browse store for closed table tabs; runs once, on first import. */
export function initSqlLink(): void {
    if (installed) return;
    installed = true;
    dropDanglingLinks();
    useBrowse.subscribe((state, prev) => {
        for (const [key, before] of Object.entries(prev.byConnection)) {
            const after = state.byConnection[Number(key)];
            if (after === before) continue;
            const open = new Set(after?.tabs.map((t) => t.id));
            for (const t of before.tabs)
                if (t.kind === 'table' && !open.has(t.id))
                    onBrowseTabClosed(Number(key), t.id);
        }
    });
}

initSqlLink();
