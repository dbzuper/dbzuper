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

    it('says when the table no longer exists', () => {
        useBrowse.getState().openTable(1, 'gone');
        render(<Harness table="gone" />);
        expect(
            screen.getByText(/This table no longer exists/),
        ).toBeInTheDocument();
        expect(api.rows).not.toHaveBeenCalled();
    });
});
