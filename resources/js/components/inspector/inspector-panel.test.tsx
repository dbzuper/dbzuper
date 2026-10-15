import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { useSqlTabs } from '@/sql/tabs-store';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useWorkspace } from '@/universe/store';

const api = vi.hoisted(() => ({ rows: vi.fn(), ddl: vi.fn() }));
vi.mock('@/lib/workspace-api', async (orig) => ({
    ...(await orig<typeof import('@/lib/workspace-api')>()),
    workspaceApi: {
        ...api,
        schema: vi.fn(),
        refresh: vi.fn(),
        layout: vi.fn(),
        saveLayout: vi.fn(),
    },
}));

import { InspectorPanel } from './inspector-panel';

const snapshot = makeSnapshot(
    [
        {
            name: 'orders',
            columns: [
                {
                    name: 'id',
                    type: 'integer',
                    type_name: 'integer',
                    nullable: false,
                    default: null,
                    auto_increment: true,
                    comment: null,
                },
                {
                    name: 'user_id',
                    type: 'integer',
                    type_name: 'integer',
                    nullable: false,
                    default: null,
                    auto_increment: false,
                    comment: null,
                },
            ],
            indexes: [
                {
                    name: 'orders_user_id_index',
                    columns: ['user_id'],
                    unique: false,
                    primary: false,
                },
            ],
        },
        { name: 'users' },
        { name: 'order_items' },
    ],
    [
        {
            from_table: 'orders',
            to_table: 'users',
            from_columns: ['user_id'],
            inferred: true,
            confidence: 0.9,
        },
        {
            from_table: 'order_items',
            to_table: 'orders',
            from_columns: ['order_id'],
        },
    ],
    'pgsql',
);
const orders = snapshot.tables[0];

const page = (over: Record<string, unknown> = {}) => ({
    columns: [
        { name: 'id', type: 'integer', table: 'orders' },
        { name: 'user_id', type: 'integer', table: 'orders' },
    ],
    rows: [[1, null]],
    has_more: false,
    page: 1,
    per_page: 100,
    sql: 'select * from "orders" limit 100 offset 0',
    ...over,
});

const renderData = () => {
    useWorkspace.getState().setInspectorTab('data');
    return render(
        <InspectorPanel connectionId={1} snapshot={snapshot} table={orders} />,
    );
};
const lastBody = () => api.rows.mock.calls[api.rows.mock.calls.length - 1][2];

// jsdom has no layout; give the virtualised grid a viewport so rows and columns render.
beforeAll(() => {
    for (const [prop, value] of [
        ['clientHeight', 400],
        ['clientWidth', 800],
    ] as const)
        Object.defineProperty(HTMLElement.prototype, prop, {
            configurable: true,
            get: () => value,
        });
});

beforeEach(() => {
    useWorkspace.getState().reset();
    api.rows.mockReset();
    api.rows.mockResolvedValue(page());
    api.ddl.mockResolvedValue({ ddl: null });
});

describe('InspectorPanel', () => {
    it('lists columns with key markers', () => {
        render(
            <InspectorPanel
                connectionId={1}
                snapshot={snapshot}
                table={orders}
            />,
        );
        expect(
            screen.getByRole('heading', { name: 'orders' }),
        ).toBeInTheDocument();
        expect(screen.getByText('user_id')).toBeInTheDocument();
        expect(screen.getByLabelText('primary key')).toBeInTheDocument();
        expect(
            screen.getByLabelText('inferred foreign key'),
        ).toBeInTheDocument();
    });

    it('shows outgoing and incoming relationships and navigates to the other table', () => {
        useWorkspace.getState().setInspectorTab('relationships');
        render(
            <InspectorPanel
                connectionId={1}
                snapshot={snapshot}
                table={orders}
            />,
        );
        expect(screen.getByText('90% inferred')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'order_items' }));
        expect(useWorkspace.getState().selected).toBe('order_items');
    });

    it('loads the first page and renders NULL distinctly', async () => {
        renderData();
        expect(await screen.findByText('NULL')).toBeInTheDocument();
        expect(api.rows).toHaveBeenCalledWith(
            1,
            'orders',
            { filters: [], sort: null, page: 1, per_page: 100 },
            expect.any(AbortSignal),
        );
    });

    it('re-fetches from page 1 when a filter is added', async () => {
        renderData();
        await screen.findByText('NULL');
        fireEvent.change(screen.getByLabelText('Filter value'), {
            target: { value: '7' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
        await waitFor(() =>
            expect(lastBody()).toEqual({
                filters: [{ column: 'id', op: 'eq', value: '7' }],
                sort: null,
                page: 1,
                per_page: 100,
            }),
        );
    });

    it('sorts server-side from a column header', async () => {
        renderData();
        await screen.findByText('NULL');
        fireEvent.click(screen.getByRole('columnheader', { name: 'user_id' }));
        await waitFor(() =>
            expect(lastBody().sort).toEqual({
                column: 'user_id',
                direction: 'asc',
            }),
        );
    });

    it('enables Next page only when has_more and fetches page 2', async () => {
        renderData();
        await screen.findByText('NULL');
        expect(
            screen.getByRole('button', { name: 'Next page' }),
        ).toBeDisabled();
        api.rows.mockResolvedValue(page({ has_more: true }));
        fireEvent.change(screen.getByLabelText('Filter value'), {
            target: { value: '1' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Next page' }),
            ).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        await waitFor(() => expect(lastBody().page).toBe(2));
    });

    it('turns a pending FK filter into an eq chip and consumes it', async () => {
        useWorkspace.getState().openDataFilter('orders', 'user_id', '9');
        render(
            <InspectorPanel
                connectionId={1}
                snapshot={snapshot}
                table={orders}
            />,
        );
        expect(
            await screen.findByRole('button', {
                name: 'Remove filter user_id equals 9',
            }),
        ).toBeInTheDocument();
        expect(api.rows.mock.calls[0][2].filters).toEqual([
            { column: 'user_id', op: 'eq', value: '9' },
        ]);
        expect(useWorkspace.getState().dataFilter).toBeNull();
    });

    it('opens the generated SQL in the dock', async () => {
        const openTab = vi.spyOn(useSqlTabs.getState(), 'openTab');
        renderData();
        await screen.findByText('NULL');
        fireEvent.click(screen.getByRole('button', { name: 'Open in SQL' }));
        expect(openTab).toHaveBeenCalledWith(
            1,
            'select * from "orders" limit 100 offset 0',
            'orders',
        );
        expect(useWorkspace.getState().dockOpen).toBe(true);
    });

    it('shows the mapped API error', async () => {
        api.rows.mockRejectedValue(
            new ApiError(422, {
                error: { kind: 'syntax', message: 'Bad filter.' },
            }),
        );
        renderData();
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Bad filter.',
        );
    });

    it('falls back to generated DDL when the engine has none', async () => {
        useWorkspace.getState().setInspectorTab('ddl');
        render(
            <InspectorPanel
                connectionId={1}
                snapshot={snapshot}
                table={orders}
            />,
        );
        expect(await screen.findByText(/Approximate DDL/)).toBeInTheDocument();
        await waitFor(() =>
            expect(screen.getByTestId('ddl')).toHaveTextContent(
                'CREATE TABLE "orders"',
            ),
        );
    });

    it('starts the path finder and focus mode from the header', () => {
        render(
            <InspectorPanel
                connectionId={1}
                snapshot={snapshot}
                table={orders}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Find path to…' }));
        expect(useWorkspace.getState().pathFrom).toBe('orders');
        fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
        expect(useWorkspace.getState().focus).toEqual({
            table: 'orders',
            depth: 1,
        });
    });
});
