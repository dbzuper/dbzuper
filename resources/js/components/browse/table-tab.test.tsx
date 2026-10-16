import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowse, type TableTab } from '@/browse/browse-store';
import { rowsCache } from '@/browse/rows-cache';
import { useSqlTabs } from '@/sql/tabs-store';
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
vi.mock('@/components/grid/result-grid', () => ({
    ResultGrid: () => <div data-testid="grid" />,
}));

import { TableTabView, tableHeadingId } from './table-tab';

const connection = { id: 1, driver: 'mysql' } as ConnectionSummary;
const snapshot = makeSnapshot([{ name: 'orders' }], [], 'mysql');
const actions = {
    open: vi.fn(),
    structure: vi.fn(),
    openInSql: vi.fn(),
    showInUniverse: vi.fn(),
};

const tabOf = (table: string) =>
    useBrowse
        .getState()
        .byConnection[1].tabs.find((t) => t.id === `t:${table}`) as TableTab;

function Harness({ table = 'orders' }: { table?: string }) {
    const tab = useBrowse((s) =>
        s.byConnection[1]?.tabs.find((t) => t.id === `t:${table}`),
    ) as TableTab;
    return (
        <TableTabView
            connection={connection}
            snapshot={snapshot}
            tab={tab}
            actions={actions}
        />
    );
}

beforeEach(() => {
    useBrowse.setState({ byConnection: {} });
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
        ).toHaveAttribute('id', tableHeadingId('t:orders'));
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

    const cacheWith = (page: number, sql: string) =>
        rowsCache.set('1:orders', {
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
        rowsCache.set('1:orders', {
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
