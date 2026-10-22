import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSqlTabs, useSqlTabs, type SqlTab } from '@/sql/tabs-store';
import { tableTabOf } from '@/test/browse-tabs';
import { useBrowse, type TableTab } from './browse-store';
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
        },
        total: null,
        scrollTop: 0,
    });
    const editorId = openTableTabInSql(1, table, 'mysql');
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

        expect(openTableTabInSql(1, orders(), 'mysql')).toBe(editorId);
        expect(sqlTabs().filter((t) => t.link)).toHaveLength(1);
        expect(sqlTabs().find((t) => t.id === editorId)?.sql).toBe(
            'select 1 edited',
        );
    });

    it('links two views of one table to two editor tabs', () => {
        const { table, editorId } = linked();
        const second = useBrowse.getState().duplicateTab(1, table.id);
        const other = openTableTabInSql(1, orders(2), 'mysql');
        expect(other).not.toBe(editorId);
        expect(linkedTo(second)?.title).toBe('orders (2)');
    });

    it('falls back to a first-page SELECT when no rows answer the current request', () => {
        useBrowse.getState().openTable(1, 'orders', { mode: 'permanent' });
        const id = openTableTabInSql(1, orders(), 'pgsql');
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
        reportTableRows(1, table.id, 'key-b', 'q2');
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
        openTableTabInSql(1, orders(2), 'mysql');
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
});
