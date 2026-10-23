import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSqlTabs, useSqlTabs, type SqlTab } from '@/sql/tabs-store';
import { useWorkspace } from '@/universe/store';
import { tableTabOf } from '@/test/browse-tabs';
import { flushBrowse, useBrowse, type TableTab } from './browse-store';
import { rowsCache, rowsRequestKey } from './rows-cache';
import {
    applyToTable,
    dropDanglingLinks,
    latestTableSql,
    onBrowseTabClosed,
    onTableQuery,
    openTableTabInSql,
    registerEditorModel,
    reportTableRows,
    unregisterEditorModel,
    updateSqlFromTable,
    type EditorModel,
} from './sql-link';

const sqlTabs = () => useSqlTabs.getState().byConnection[1].tabs;
const linkedTo = (browseTabId: string): SqlTab | undefined =>
    useSqlTabs.getState().findLinked(1, browseTabId);
const orders = (ordinal = 1) => tableTabOf(1, 'orders', ordinal) as TableTab;
const keyOf = (tab: TableTab) => rowsRequestKey(tab.state);

/** Opens `orders` and its linked editor tab holding `sql`. */
function linked(sql = 'q1'): { table: TableTab; editorId: string } {
    useBrowse.getState().openTable(1, 'orders', { mode: 'permanent' });
    const table = orders();
    rowsCache.set(`1:${table.id}`, {
        requestKey: keyOf(table),
        rows: {
            columns: [],
            rows: [],
            has_more: false,
            page: 1,
            per_page: 100,
            sql,
            editing: { method: 'none', reason: null, read_only_columns: [] },
            row_ids: [],
            locked: [],
            shortened: [],
        },
        total: null,
        scrollTop: 0,
    });
    const editorId = openTableTabInSql(1, table, 'mysql', []);
    return { table, editorId };
}

/** A stand-in for a Monaco text model. */
function fakeModel(initial: string) {
    let value = initial;
    const undo: string[] = [];
    const disposeListeners: (() => void)[] = [];
    const model = {
        getValue: () => value,
        isDisposed: () => false,
        getFullModelRange: () => ({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: value.length + 1,
        }),
        pushStackElement: vi.fn(),
        pushEditOperations: vi.fn(
            (_sel: unknown, ops: { text: string | null }[]) => {
                undo.push(value);
                value = ops[0].text ?? '';
                return null;
            },
        ),
        onWillDispose: (fn: () => void) => {
            disposeListeners.push(fn);
            return { dispose: () => {} };
        },
        undo: () => {
            value = undo.pop() ?? value;
        },
        dispose: () => disposeListeners.forEach((fn) => fn()),
    };
    return model;
}

beforeEach(() => {
    useBrowse.setState({ byConnection: {} });
    useSqlTabs.setState({ byConnection: {} });
    flushSqlTabs();
    rowsCache.clear();
});

describe('Open in SQL', () => {
    it('opens one linked editor tab per table tab, titled like it, with its query', () => {
        const { table, editorId } = linked('select 1');
        expect(sqlTabs().find((t) => t.id === editorId)).toMatchObject({
            title: 'orders',
            sql: 'select 1',
            link: {
                browseTabId: table.id,
                table: 'orders',
                syncedSql: 'select 1',
            },
        });
        useSqlTabs.getState().setSql(1, editorId, 'select 1 edited');

        expect(openTableTabInSql(1, orders(), 'mysql', [])).toBe(editorId);
        expect(sqlTabs().filter((t) => t.link)).toHaveLength(1);
        expect(sqlTabs().find((t) => t.id === editorId)?.sql).toBe(
            'select 1 edited',
        );
    });

    it('links two views of one table to two editor tabs', () => {
        const { table, editorId } = linked();
        const second = useBrowse.getState().duplicateTab(1, table.id);
        const other = openTableTabInSql(1, orders(2), 'mysql', []);
        expect(other).not.toBe(editorId);
        expect(linkedTo(second)?.title).toBe('orders (2)');
    });

    it('falls back to a first-page SELECT when no rows answer the current request', () => {
        useBrowse.getState().openTable(1, 'orders', { mode: 'permanent' });
        const id = openTableTabInSql(1, orders(), 'pgsql', []);
        expect(sqlTabs().find((t) => t.id === id)?.sql).toBe(
            'SELECT * FROM "orders" LIMIT 100',
        );
    });
});

describe('table → editor', () => {
    it('replaces unedited text and updates syncedSql', () => {
        const { table, editorId } = linked('q1');
        onTableQuery(1, table.id, 'q2');
        const tab = linkedTo(table.id)!;
        expect(tab.id).toBe(editorId);
        expect(tab.sql).toBe('q2');
        expect(tab.link).toMatchObject({ syncedSql: 'q2' });
        expect(tab.link?.stale).toBeFalsy();
    });

    it('leaves edited text alone and marks the link stale', () => {
        const { table, editorId } = linked('q1');
        useSqlTabs.getState().setSql(1, editorId, 'my edit');
        onTableQuery(1, table.id, 'q2');
        const tab = linkedTo(table.id)!;
        expect(tab.sql).toBe('my edit');
        expect(tab.link).toMatchObject({ syncedSql: 'q1', stale: true });
        expect(latestTableSql(1, table.id)).toBe('q2');
    });

    it('does nothing for a query the editor already has', () => {
        const { table, editorId } = linked('q1');
        useSqlTabs.getState().setSql(1, editorId, 'my edit');
        onTableQuery(1, table.id, 'q1');
        expect(linkedTo(table.id)?.link?.stale).toBeFalsy();
    });

    it('reports only responses to a new request, not a refetch of the same one', () => {
        const { table } = linked('q1');
        reportTableRows(1, table.id, 'key-a', 'q2');
        expect(linkedTo(table.id)?.sql).toBe('q2');
        // A Refresh of the same request (the server may format it differently).
        reportTableRows(1, table.id, 'key-a', 'q2 again');
        expect(linkedTo(table.id)?.sql).toBe('q2');
        reportTableRows(1, table.id, 'key-b', 'q3');
        expect(linkedTo(table.id)?.sql).toBe('q3');
    });

    it('updates the text through the mounted Monaco model so undo restores it', () => {
        const { table, editorId } = linked('q1');
        const model = fakeModel('q1');
        registerEditorModel(editorId, model as unknown as EditorModel);
        onTableQuery(1, table.id, 'q2');

        expect(model.pushEditOperations).toHaveBeenCalledTimes(1);
        expect(model.pushEditOperations.mock.calls[0][1]).toEqual([
            { range: model.getFullModelRange(), text: 'q2' },
        ]);
        expect(model.pushStackElement).toHaveBeenCalled();
        expect(model.getValue()).toBe('q2');
        expect(linkedTo(table.id)?.sql).toBe('q2');
        model.undo();
        expect(model.getValue()).toBe('q1');

        unregisterEditorModel(editorId, model as unknown as EditorModel);
        onTableQuery(1, table.id, 'q3');
        expect(model.pushEditOperations).toHaveBeenCalledTimes(1);
        expect(linkedTo(table.id)?.sql).toBe('q3');
    });

    it('forgets a model once it is disposed', () => {
        const { table, editorId } = linked('q1');
        const model = fakeModel('q1');
        registerEditorModel(editorId, model as unknown as EditorModel);
        model.dispose();
        onTableQuery(1, table.id, 'q2');
        expect(model.pushEditOperations).not.toHaveBeenCalled();
        expect(linkedTo(table.id)?.sql).toBe('q2');
    });

    it('Update SQL takes the latest table query and clears stale', () => {
        const { table, editorId } = linked('q1');
        useSqlTabs.getState().setSql(1, editorId, 'my edit');
        useBrowse.getState().updateTable(1, table.id, { page: 2 });
        reportTableRows(1, table.id, keyOf(orders()), 'q2');
        expect(linkedTo(table.id)?.link?.stale).toBe(true);

        expect(updateSqlFromTable(1, table.id)).toBe(true);
        expect(linkedTo(table.id)).toMatchObject({
            sql: 'q2',
            link: { syncedSql: 'q2' },
        });
        expect(linkedTo(table.id)?.link?.stale).toBeFalsy();
    });
});

describe('closing the table tab', () => {
    it('marks the link closed when the table tab closes', () => {
        const { table, editorId } = linked('q1');
        useBrowse.getState().closeTab(1, table.id);
        expect(sqlTabs().find((t) => t.id === editorId)?.link).toMatchObject({
            closed: true,
            browseTabId: table.id,
        });
        // A later table query no longer reaches it.
        onTableQuery(1, table.id, 'q2');
        expect(sqlTabs().find((t) => t.id === editorId)?.sql).toBe('q1');
        // Editing ends the link.
        useSqlTabs.getState().setSql(1, editorId, 'q1 edited');
        expect(sqlTabs().find((t) => t.id === editorId)?.link).toBeUndefined();
    });

    it('marks every closed table tab of closeOthers / closeAll', () => {
        const { table } = linked('q1');
        const second = useBrowse.getState().duplicateTab(1, table.id);
        openTableTabInSql(1, orders(2), 'mysql', []);
        useBrowse.getState().closeAll(1);
        expect(linkedTo(table.id)?.link?.closed).toBe(true);
        expect(linkedTo(second)?.link?.closed).toBe(true);
    });

    it('onBrowseTabClosed marks only that tab', () => {
        const { table } = linked('q1');
        onBrowseTabClosed(1, 't:other');
        expect(linkedTo(table.id)?.link?.closed).toBeFalsy();
    });

    it('on restore, links to table tabs that no longer exist are closed', () => {
        useSqlTabs
            .getState()
            .openLinkedTab(1, 't:gone', 'orders', 'orders', 'q');
        const { table } = linked('q1');
        dropDanglingLinks();
        expect(linkedTo('t:gone')?.link?.closed).toBe(true);
        expect(linkedTo(table.id)?.link?.closed).toBeFalsy();
    });
});

describe('editor → table', () => {
    it('applies a matched state, activates the table tab and clears stale', () => {
        const { table, editorId } = linked('q1');
        useBrowse.getState().openTable(1, 'users', { mode: 'permanent' });
        useSqlTabs.getState().setSql(1, editorId, 'my query');
        onTableQuery(1, table.id, 'q2');
        expect(linkedTo(table.id)?.link?.stale).toBe(true);

        const filters = [
            { column: 'status', op: 'eq' as const, value: 'paid' },
        ];
        const sort = [{ column: 'id', direction: 'desc' as const }];
        applyToTable(1, linkedTo(table.id)!.link!, {
            filters,
            sort,
            page: 2,
            perPage: null,
        });

        expect(orders().state).toMatchObject({
            filters,
            sort,
            page: 2,
            perPage: 100,
        });
        expect(useBrowse.getState().byConnection[1].activeId).toBe(table.id);
        expect(linkedTo(table.id)?.link).toMatchObject({
            syncedSql: 'my query',
        });
        expect(linkedTo(table.id)?.link?.stale).toBeFalsy();

        // The rows that answer the applied state keep the user's text.
        reportTableRows(1, table.id, keyOf(orders()), 'server sql');
        expect(linkedTo(table.id)?.sql).toBe('my query');
        expect(latestTableSql(1, table.id)).toBe('server sql');
    });

    it('sets the page size when the statement has one', () => {
        const { table } = linked('q1');
        applyToTable(1, linkedTo(table.id)!.link!, {
            filters: [],
            sort: [],
            page: 1,
            perPage: 500,
        });
        expect(orders().state.perPage).toBe(500);
    });

    it('returns true when applied and false when the table tab is gone', () => {
        const { table } = linked('q1');
        const state = { filters: [], sort: [], page: 1, perPage: null };
        const link = linkedTo(table.id)!.link!;
        expect(applyToTable(1, link, state)).toBe(true);
        expect(applyToTable(1, { ...link, browseTabId: 'gone' }, state)).toBe(
            false,
        );
    });
});

describe('fix round 1', () => {
    const editor = (browseTabId: string) => linkedTo(browseTabId)!;

    it('records the request key and table title on the link', () => {
        const { table } = linked('q1');
        expect(editor(table.id).link).toMatchObject({
            requestKey: keyOf(table),
            title: 'orders',
        });
        reportTableRows(1, table.id, 'key-b', 'q2');
        expect(editor(table.id).link?.requestKey).toBe('key-b');
    });

    it('after a reload, a response to the applied request changes nothing', () => {
        const { table, editorId } = linked('q1');
        useSqlTabs.getState().setSql(1, editorId, 'my statement');
        // As saved before the reload: applied text, applied request; nothing in memory.
        useSqlTabs.getState().setLink(1, editorId, {
            ...editor(table.id).link!,
            syncedSql: 'my statement',
            requestKey: 'applied',
        });
        reportTableRows(1, table.id, 'applied', 'server formatted sql');
        expect(editor(table.id).sql).toBe('my statement');
        expect(editor(table.id).link?.stale).toBeFalsy();

        useSqlTabs.getState().setSql(1, editorId, 'my statement, edited');
        reportTableRows(1, table.id, 'applied', 'server formatted sql');
        expect(editor(table.id).link?.stale).toBeFalsy();
    });

    it('a second window sharing storage does not replace the applied text', async () => {
        const { table, editorId } = linked('q1');
        useSqlTabs.getState().setSql(1, editorId, 'my statement');
        applyToTable(1, editor(table.id).link!, {
            filters: [{ column: 'status', op: 'eq', value: 'paid' }],
            sort: [],
            page: 1,
            perPage: null,
        });
        const { flushBrowse } = await import('./browse-store');
        flushBrowse();
        flushSqlTabs();

        vi.resetModules();
        const other = await import('./sql-link');
        const otherSql = (await import('@/sql/tabs-store')).useSqlTabs;
        const otherBrowse = (await import('./browse-store')).useBrowse;
        await otherSql.persist.rehydrate();
        await otherBrowse.persist.rehydrate();
        const tab = otherBrowse
            .getState()
            .byConnection[1].tabs.find((t) => t.id === table.id) as TableTab;
        other.reportTableRows(1, table.id, keyOf(tab), 'server sql');
        const theirs = otherSql.getState().findLinked(1, table.id)!;
        expect(theirs.sql).toBe('my statement');
        expect(theirs.link?.syncedSql).toBe('my statement');
    });

    it('with no rows cached, links a query built from the tab state and syncs on the next response', () => {
        useBrowse.getState().openTable(1, 'orders', {
            mode: 'permanent',
            state: {
                filters: [{ column: 'status', op: 'eq', value: 'paid' }],
                page: 2,
            },
        });
        const id = openTableTabInSql(1, orders(), 'mysql', []);
        const tab = sqlTabs().find((t) => t.id === id)!;
        expect(tab.sql).toBe(
            "SELECT * FROM `orders` WHERE `status` = 'paid' LIMIT 100 OFFSET 100",
        );
        expect(tab.link?.requestKey).toBeUndefined();
        // Even a response for the unchanged state replaces it with the server's query.
        reportTableRows(1, orders().id, keyOf(orders()), 'server sql');
        expect(editor(orders().id).sql).toBe('server sql');
        expect(editor(orders().id).link?.requestKey).toBe(keyOf(orders()));
    });

    it('applyToTable shows the Data view', () => {
        const { table } = linked('q1');
        useBrowse.getState().updateTable(1, table.id, { view: 'structure' });
        applyToTable(1, editor(table.id).link!, {
            filters: [],
            sort: [],
            page: 1,
            perPage: null,
        });
        expect(orders().state.view).toBe('data');
    });

    it('clears stale when the table query returns to syncedSql', () => {
        const { table, editorId } = linked('q1');
        useSqlTabs.getState().setSql(1, editorId, 'my edit');
        reportTableRows(1, table.id, 'key-b', 'q2');
        expect(editor(table.id).link?.stale).toBe(true);
        reportTableRows(1, table.id, 'key-a', 'q1');
        expect(editor(table.id).link?.stale).toBeFalsy();
        expect(editor(table.id).sql).toBe('my edit');
    });

    it('setLink keeps one editor tab per table tab', () => {
        const { table, editorId } = linked('q1');
        const other = useSqlTabs.getState().openTab(1, 'x');
        useSqlTabs.getState().setLink(1, other, {
            ...editor(table.id).link!,
        });
        expect(sqlTabs().find((t) => t.id === other)?.link).toBeUndefined();
        expect(editor(table.id).id).toBe(editorId);
    });

    it('opening a linked editor keeps a preview table tab', () => {
        useBrowse.getState().openTable(1, 'orders', { mode: 'preview' });
        expect(orders().preview).toBe(true);
        openTableTabInSql(1, orders(), 'mysql', []);
        expect(orders().preview).toBe(false);
    });
});

describe('task 6', () => {
    const editor = (browseTabId: string) => linkedTo(browseTabId)!;

    it('a built query edited before the first response adopts its request key and is not stale', () => {
        useBrowse.getState().openTable(1, 'orders', { mode: 'permanent' });
        const id = openTableTabInSql(1, orders(), 'mysql', []);
        expect(editor(orders().id).link?.requestKey).toBeUndefined();
        useSqlTabs.getState().setSql(1, id, 'my edit');

        reportTableRows(1, orders().id, keyOf(orders()), 'server sql');

        expect(editor(orders().id).sql).toBe('my edit');
        expect(editor(orders().id).link?.stale).toBeFalsy();
        expect(editor(orders().id).link?.requestKey).toBe(keyOf(orders()));
        // A later new request does make it stale.
        useBrowse.getState().updateTable(1, orders().id, { page: 2 });
        reportTableRows(1, orders().id, keyOf(orders()), 'q2');
        expect(editor(orders().id).link?.stale).toBe(true);
    });

    it('a response to another request than the built query still marks edited text stale', () => {
        useBrowse.getState().openTable(1, 'orders', { mode: 'permanent' });
        const id = openTableTabInSql(1, orders(), 'mysql', []);
        useSqlTabs.getState().setSql(1, id, 'my edit');
        reportTableRows(1, orders().id, 'another key', 'q2');
        expect(editor(orders().id).link?.stale).toBe(true);
    });

    it('Update SQL rebuilds the query from the tab state when no query is known', () => {
        const { table, editorId } = linked('q1');
        useSqlTabs.getState().setSql(1, editorId, 'my edit');
        rowsCache.clear();
        useBrowse.getState().updateTable(1, table.id, {
            filters: [{ column: 'status', op: 'eq', value: 'paid' }],
        });
        expect(updateSqlFromTable(1, table.id)).toBe(false);
        expect(updateSqlFromTable(1, table.id, 'mysql')).toBe(true);
        expect(editor(table.id).sql).toBe(
            "SELECT * FROM `orders` WHERE `status` = 'paid' LIMIT 100",
        );
        expect(editor(table.id).link?.syncedSql).toBe(editor(table.id).sql);
    });
});

describe('linked tabs follow each other', () => {
    const browseActive = () => useBrowse.getState().byConnection[1].activeId;
    const sqlActive = () => useSqlTabs.getState().byConnection[1].activeId;

    /** Two views of `orders`, each with its linked editor tab; the second view and its editor are active. */
    function twoLinked() {
        useWorkspace.setState({ dockOpen: true });
        useBrowse.getState().openTable(1, 'orders', { mode: 'permanent' });
        const e1 = openTableTabInSql(1, orders(1), 'mysql', []);
        useBrowse.getState().openNewView(1, 'orders');
        const e2 = openTableTabInSql(1, orders(2), 'mysql', []);
        return { t1: orders(1).id, t2: orders(2).id, e1, e2 };
    }

    beforeEach(() => useWorkspace.setState({ dockOpen: false }));

    it('activating a table tab activates its linked editor tab when the dock is open', () => {
        const { t1, t2, e1, e2 } = twoLinked();
        expect([browseActive(), sqlActive()]).toEqual([t2, e2]);
        useBrowse.getState().activate(1, t1);
        expect(sqlActive()).toBe(e1);
        useBrowse.getState().cycle(1, 1);
        expect(sqlActive()).toBe(e2);
        useBrowse.getState().activateIndex(1, 1);
        expect(sqlActive()).toBe(e1);
    });

    it('a closed dock is left alone', () => {
        const { t1, e2 } = twoLinked();
        useWorkspace.setState({ dockOpen: false });
        useBrowse.getState().activate(1, t1);
        expect(sqlActive()).toBe(e2);
        expect(useWorkspace.getState().dockOpen).toBe(false);
    });

    it('Universe, Records and unlinked table tabs leave the dock alone', () => {
        const { e2 } = twoLinked();
        useBrowse.getState().activate(1, 'universe');
        expect(sqlActive()).toBe(e2);
        useBrowse.getState().showRecords(1, 'Records');
        expect(sqlActive()).toBe(e2);
        useBrowse.getState().openTable(1, 'users', { mode: 'permanent' });
        expect(sqlActive()).toBe(e2);
    });

    it('activating a linked editor tab activates its table tab', () => {
        const { t1, t2, e1, e2 } = twoLinked();
        useSqlTabs.getState().setActive(1, e1);
        expect(browseActive()).toBe(t1);
        useSqlTabs.getState().setActive(1, e2);
        expect(browseActive()).toBe(t2);
    });

    it('scratchpad editor tabs and closed links leave the main area alone', () => {
        const { t1, t2, e1 } = twoLinked();
        const scratch = useSqlTabs.getState().openTab(1, 'select 1');
        expect(browseActive()).toBe(t2);
        useSqlTabs.getState().setActive(1, e1);
        expect(browseActive()).toBe(t1);
        useBrowse.getState().closeTab(1, t1);
        expect(useSqlTabs.getState().findLinked(1, t1)?.link?.closed).toBe(
            true,
        );
        useSqlTabs.getState().setActive(1, scratch);
        useBrowse.getState().activate(1, 'universe');
        useSqlTabs.getState().setActive(1, e1);
        expect(browseActive()).toBe('universe');
    });

    it('closing the active tab is no activation: the other side stays', () => {
        const { t1, t2, e1, e2 } = twoLinked();
        useSqlTabs.getState().closeTab(1, e2);
        expect(sqlActive()).toBe(e1);
        expect(browseActive()).toBe(t2);
        useBrowse.getState().activate(1, t1);
        expect(sqlActive()).toBe(e1);
        const scratch = useSqlTabs.getState().openTab(1);
        useBrowse.getState().closeTab(1, t1);
        expect(browseActive()).toBe(t2);
        expect(sqlActive()).toBe(scratch);
    });

    it('applyToTable activates the table tab without bouncing the dock', () => {
        const { t1, e1 } = twoLinked();
        useSqlTabs.getState().setActive(1, e1);
        useBrowse.getState().activate(1, 'universe');
        const sqlChanges: string[] = [];
        const off = useSqlTabs.subscribe((s, p) => {
            if (s.byConnection[1].activeId !== p.byConnection[1].activeId)
                sqlChanges.push(s.byConnection[1].activeId);
        });
        expect(
            applyToTable(1, linkedTo(t1)!.link!, {
                filters: [],
                sort: [],
                page: 2,
                perPage: null,
            }),
        ).toBe(true);
        off();
        expect(browseActive()).toBe(t1);
        expect(sqlActive()).toBe(e1);
        expect(sqlChanges).toEqual([]);
    });

    it('a rehydrate from another window does not follow', async () => {
        const { t1, t2, e1 } = twoLinked();
        useBrowse.getState().activate(1, t1);
        expect(sqlActive()).toBe(e1);
        // Static import: an earlier test reset the module registry.
        flushBrowse();
        flushSqlTabs();
        // Another window activates t2; both tabs stay open, so this window's previous tab survives.
        const raw = JSON.parse(localStorage.getItem('dbsuperb.browse')!);
        raw.state.byConnection[1].activeId = t2;
        localStorage.setItem('dbsuperb.browse', JSON.stringify(raw));
        // An active id that changes while the store hydrates (whatever merge decides) is not followed.
        const off = useBrowse.persist.onHydrate(() =>
            useBrowse.setState((s) => ({
                byConnection: {
                    ...s.byConnection,
                    1: { ...s.byConnection[1], activeId: t2 },
                },
            })),
        );
        await useBrowse.persist.rehydrate();
        off();
        expect(useBrowse.persist.hasHydrated()).toBe(true);
        expect(sqlActive()).toBe(e1);
        // After the rehydrate, this window's own activations follow again.
        useBrowse.getState().activate(1, t1);
        useBrowse.getState().activate(1, t2);
        expect(sqlActive()).not.toBe(e1);
    });

    it('restoring ?tab= on load is an activation: the open dock follows', () => {
        const { t1, e1 } = twoLinked();
        // use-browse-url restores a deep-linked view with activate(), like a tab click.
        useBrowse.getState().activate(1, t1);
        expect(sqlActive()).toBe(e1);
    });
});
