import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowse, type TableTab } from '@/browse/browse-store';
import { rowsCache } from '@/browse/rows-cache';
import { usePending } from '@/editing/pending-store';
import { useReview } from '@/editing/review-store';
import { useSqlTabs } from '@/sql/tabs-store';
import type { RowsResponse } from '@/lib/workspace-api';
import type { ConnectionSummary } from '@/types/connection';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useWorkspace } from '@/universe/store';

const api = vi.hoisted(() => ({
    rows: vi.fn(),
    count: vi.fn(),
    ddl: vi.fn(),
}));
vi.mock('@/lib/workspace-api', async (orig) => ({
    ...(await orig<typeof import('@/lib/workspace-api')>()),
    workspaceApi: { ...api },
}));
const editingApi = vi.hoisted(() => ({ preview: vi.fn(), commit: vi.fn() }));
vi.mock('@/editing/editing-api', async (orig) => ({
    ...(await orig<typeof import('@/editing/editing-api')>()),
    editingApi,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/grid/result-grid', () => ({
    ResultGrid: () => <div data-testid="grid" />,
}));

import { TableTabView, tableHeadingId } from './table-tab';
import { tableTabOf } from '@/test/browse-tabs';

const connection = { id: 1, driver: 'mysql' } as ConnectionSummary;
const snapshot = makeSnapshot([{ name: 'orders' }], [], 'mysql');
const actions = {
    open: vi.fn(),
    structure: vi.fn(),
    openInSql: vi.fn(),
    showInUniverse: vi.fn(),
};

const tabOf = (table: string) => tableTabOf(1, table) as TableTab;

function Harness({
    table = 'orders',
    readOnly = false,
}: {
    table?: string;
    readOnly?: boolean;
}) {
    const tab = useBrowse((s) =>
        s.byConnection[1]?.tabs.find(
            (t) => t.kind === 'table' && t.table === table && t.ordinal === 1,
        ),
    ) as TableTab;
    return (
        <TableTabView
            connection={
                readOnly ? { ...connection, read_only: true } : connection
            }
            snapshot={snapshot}
            tab={tab}
            actions={actions}
        />
    );
}

beforeEach(() => {
    useBrowse.setState({ byConnection: {} });
    usePending.setState({ byTable: {}, errors: {} });
    useReview.setState({ open: null, nonce: 0 });
    toast.success.mockReset();
    useSqlTabs.setState({ byConnection: {} });
    rowsCache.clear();
    api.rows.mockReset();
    api.rows.mockReturnValue(new Promise(() => {}));
    api.count.mockResolvedValue({ count: 1, kind: 'exact' });
    api.ddl.mockResolvedValue({ ddl: null });
});

describe('TableTabView', () => {
    it('labels the panel with the table name and switches to Structure', () => {
        useBrowse.getState().openTable(1, 'orders');
        render(<Harness />);
        expect(
            screen.getByRole('heading', { level: 2, name: 'orders' }),
        ).toHaveAttribute('id', tableHeadingId(tabOf('orders').id));
        expect(screen.getByRole('radio', { name: 'Data' })).toHaveAttribute(
            'aria-checked',
            'true',
        );
        fireEvent.click(screen.getByRole('radio', { name: 'Structure' }));
        expect(tabOf('orders').state.view).toBe('structure');
        expect(
            screen.getByRole('heading', { level: 3, name: 'Indexes' }),
        ).toBeInTheDocument();
    });

    it('opens a quoted SELECT in the SQL dock', () => {
        useBrowse.getState().openTable(1, 'orders');
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Open in SQL' }));
        const tabs = useSqlTabs.getState().byConnection[1].tabs;
        expect(tabs[tabs.length - 1].sql).toBe(
            'SELECT * FROM `orders` LIMIT 100',
        );
        expect(useWorkspace.getState().dockOpen).toBe(true);
    });

    it('opens one linked editor tab however often Open in SQL is pressed', () => {
        useBrowse.getState().openTable(1, 'orders');
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Open in SQL' }));
        useSqlTabs.getState().openTab(1, 'other');
        fireEvent.click(screen.getByRole('button', { name: 'Open in SQL' }));
        const sql = useSqlTabs.getState().byConnection[1];
        const linked = sql.tabs.filter((t) => t.link);
        expect(linked).toHaveLength(1);
        expect(linked[0]).toMatchObject({
            title: 'orders',
            link: { browseTabId: tabOf('orders').id, table: 'orders' },
        });
        expect(sql.activeId).toBe(linked[0].id);
    });

    const cacheWith = (page: number, sql: string) =>
        rowsCache.set(`1:${tabOf('orders').id}`, {
            requestKey: JSON.stringify({
                filters: [],
                sort: [],
                page,
                perPage: 100,
            }),
            rows: {
                columns: [{ name: 'id', type: 'int', table: 'orders' }],
                rows: [[1]],
                has_more: false,
                page,
                per_page: 100,
                sql,
                editing: {
                    method: 'primary_key',
                    reason: null,
                    read_only_columns: [],
                },
                row_ids: [{ key: { id: 1 } }],
                locked: [[]],
                shortened: [[]],
            },
            total: { count: 1, exact: true },
            scrollTop: 0,
        });
    const openedSql = () => {
        fireEvent.click(screen.getByRole('button', { name: 'Open in SQL' }));
        const tabs = useSqlTabs.getState().byConnection[1].tabs;
        return tabs[tabs.length - 1].sql;
    };

    it('opens the SQL of the cached rows when they answer the current request', () => {
        useBrowse.getState().openTable(1, 'orders');
        cacheWith(1, 'select * from `orders` limit 100 offset 0');
        render(<Harness />);
        expect(openedSql()).toBe('select * from `orders` limit 100 offset 0');
    });

    it('builds the SELECT when the cached rows answer an older request', () => {
        useBrowse.getState().openTable(1, 'orders');
        cacheWith(2, 'select * from `orders` limit 100 offset 100');
        render(<Harness />);
        expect(openedSql()).toBe('SELECT * FROM `orders` LIMIT 100');
    });

    const editableRows = {
        columns: [{ name: 'id', type: 'int', table: 'orders' }],
        rows: [[1]],
        has_more: false,
        page: 1,
        per_page: 100,
        sql: 'select 1',
        editing: {
            method: 'primary_key',
            reason: null,
            read_only_columns: [],
        },
        row_ids: [{ key: { id: 1 } }],
        locked: [[]],
        shortened: [[]],
    };

    it('adds a new row for an editable table, shared by every view of it', async () => {
        useBrowse.getState().openTable(1, 'orders');
        api.rows.mockResolvedValue(editableRows);
        render(<Harness />);
        fireEvent.click(await screen.findByRole('button', { name: 'Add row' }));
        expect(usePending.getState().count(1, 'orders')).toEqual({
            inserted: 1,
            updated: 0,
            deleted: 0,
        });
        // Adding a row is an interaction that keeps a preview tab.
        expect(tabOf('orders').preview).toBe(false);
    });

    it('offers no Add row for a table that cannot be edited or a read-only connection', async () => {
        useBrowse.getState().openTable(1, 'orders');
        api.rows.mockResolvedValue({
            ...editableRows,
            editing: { method: 'none', reason: 'x', read_only_columns: [] },
            row_ids: [null],
        });
        const { unmount } = render(<Harness />);
        await waitFor(() => expect(api.rows).toHaveBeenCalled());
        await act(async () => {});
        expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull();
        unmount();
        rowsCache.clear();
        api.rows.mockResolvedValue(editableRows);
        render(<Harness readOnly />);
        await waitFor(() => expect(api.rows).toHaveBeenCalledTimes(2));
        await act(async () => {});
        expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull();
    });

    it('commits from Review: clears the changes, drops the cached rows of every view and refetches', async () => {
        useBrowse.getState().openTable(1, 'orders', { mode: 'permanent' });
        const second = useBrowse.getState().openNewView(1, 'orders');
        useBrowse.getState().activate(1, tabOf('orders').id);
        api.rows.mockResolvedValue(editableRows);
        render(<Harness />);
        await screen.findByRole('button', { name: 'Add row' });
        expect(api.rows).toHaveBeenCalledTimes(1);
        rowsCache.set(`1:${second}`, {
            requestKey: 'x',
            rows: editableRows as RowsResponse,
            total: null,
            scrollTop: 0,
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
        editingApi.preview.mockResolvedValue({
            statements: [
                { index: 0, op: 'insert', sql: 'INSERT 1', target: 'new row' },
                { index: 1, op: 'insert', sql: 'INSERT 2', target: 'new row' },
            ],
        });
        editingApi.commit.mockResolvedValue({
            applied: { inserted: 2, updated: 0, deleted: 0 },
        });
        fireEvent.click(
            screen.getByRole('button', { name: 'Review & commit…' }),
        );
        fireEvent.click(
            await screen.findByRole('button', { name: 'Commit 2 changes' }),
        );
        await waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith('2 changes committed'),
        );
        expect(usePending.getState().byTable).toEqual({});
        expect(rowsCache.get(`1:${second}`)).toBeUndefined();
        await waitFor(() => expect(api.rows).toHaveBeenCalledTimes(2));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('says when the table no longer exists', () => {
        useBrowse.getState().openTable(1, 'gone');
        render(<Harness table="gone" />);
        expect(
            screen.getByText(/This table no longer exists/),
        ).toBeInTheDocument();
        expect(api.rows).not.toHaveBeenCalled();
    });

    it('refreshes the data even when Refresh is clicked in Structure', async () => {
        useBrowse.getState().openTable(1, 'orders');
        rowsCache.set(`1:${tabOf('orders').id}`, {
            requestKey: JSON.stringify({
                filters: [],
                sort: [],
                page: 1,
                perPage: 100,
            }),
            rows: {
                columns: [{ name: 'id', type: 'int', table: 'orders' }],
                rows: [[1]],
                has_more: false,
                page: 1,
                per_page: 100,
                sql: 'select 1',
                editing: {
                    method: 'primary_key',
                    reason: null,
                    read_only_columns: [],
                },
                row_ids: [{ key: { id: 1 } }],
                locked: [[]],
                shortened: [[]],
            },
            total: { count: 1, exact: true },
            scrollTop: 0,
        });
        render(<Harness />);
        expect(api.rows).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('radio', { name: 'Structure' }));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Data' }));
        expect(api.rows).toHaveBeenCalledTimes(1);
    });
});
