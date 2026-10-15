import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
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

afterEach(() => {
    vi.restoreAllMocks();
    useSqlTabs.setState({ byConnection: {} });
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
        useWorkspace
            .getState()
            .openDataFilter('orders', [{ column: 'user_id', value: '9' }]);
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

    it('seeds one eq chip per pair of a multi-column filter', async () => {
        useWorkspace.getState().openDataFilter('orders', [
            { column: 'user_id', value: '9' },
            { column: 'shop_id', value: '2' },
        ]);
        render(
            <InspectorPanel
                connectionId={1}
                snapshot={snapshot}
                table={orders}
            />,
        );
        expect(
            await screen.findByRole('button', {
                name: 'Remove filter shop_id equals 2',
            }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', {
                name: 'Remove filter user_id equals 9',
            }),
        ).toBeInTheDocument();
        expect(api.rows.mock.calls[0][2].filters).toEqual([
            { column: 'user_id', op: 'eq', value: '9' },
            { column: 'shop_id', op: 'eq', value: '2' },
        ]);
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
        expect(useSqlTabs.getState().byConnection[1].tabs.at(-1)).toMatchObject(
            {
                title: 'orders',
                sql: 'select * from "orders" limit 100 offset 0',
            },
        );
    });

    it('shows the mapped DB error', async () => {
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

    it('shows the first message of a Laravel validation error', async () => {
        api.rows.mockRejectedValue(
            new ApiError(422, {
                message: 'The filters.0.value field is invalid.',
                errors: { 'filters.0.value': ['Filter value is invalid.'] },
            }),
        );
        renderData();
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Filter value is invalid.',
        );
    });

    const echoPage = (hasMore = true) =>
        api.rows.mockImplementation(async (_i, _t, b) =>
            page({ page: b.page, has_more: hasMore }),
        );
    const addFilter = (value: string) => {
        fireEvent.change(screen.getByLabelText('Filter value'), {
            target: { value },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    };

    it('resets to page 1 when a filter changes on page 2', async () => {
        echoPage();
        renderData();
        await screen.findByText('NULL');
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        await screen.findByText('Rows 101–101');
        addFilter('5');
        await waitFor(() =>
            expect(lastBody()).toMatchObject({
                page: 1,
                filters: [{ column: 'id', op: 'eq', value: '5' }],
            }),
        );
    });

    it('resets to page 1 when the sort changes on page 2', async () => {
        echoPage();
        renderData();
        await screen.findByText('NULL');
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        await screen.findByText('Rows 101–101');
        fireEvent.click(screen.getByRole('columnheader', { name: 'user_id' }));
        await waitFor(() =>
            expect(lastBody()).toMatchObject({
                page: 1,
                sort: { column: 'user_id', direction: 'asc' },
            }),
        );
    });

    it('ignores a stale response that arrives after a newer one', async () => {
        const resolvers: ((v: unknown) => void)[] = [];
        api.rows.mockImplementation(
            () => new Promise((resolve) => resolvers.push(resolve)),
        );
        renderData();
        await waitFor(() => expect(resolvers).toHaveLength(1));
        addFilter('5');
        await waitFor(() => expect(resolvers).toHaveLength(2));
        resolvers[1](page({ rows: [[2, null]], sql: 'newer' }));
        await screen.findByText('Rows 1–1');
        resolvers[0](page({ rows: [[1, null]], sql: 'older' }));
        await new Promise((r) => setTimeout(r, 20));
        const openTab = vi.spyOn(useSqlTabs.getState(), 'openTab');
        fireEvent.click(screen.getByRole('button', { name: 'Open in SQL' }));
        expect(openTab).toHaveBeenCalledWith(1, 'newer', 'orders');
    });

    it('clears the previous rows and disables actions when a fetch fails', async () => {
        renderData();
        await screen.findByText('NULL');
        echoPage();
        api.rows.mockRejectedValue(
            new ApiError(422, { error: { kind: 'x', message: 'Boom.' } }),
        );
        addFilter('5');
        expect(await screen.findByRole('alert')).toHaveTextContent('Boom.');
        expect(screen.queryByText('NULL')).not.toBeInTheDocument();
        expect(screen.queryByText(/^Rows /)).not.toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Next page' }),
        ).toBeDisabled();
        expect(
            screen.getByRole('button', { name: 'Open in SQL' }),
        ).toBeDisabled();
    });

    it('disables paging and Open in SQL while loading and keeps the loaded range', async () => {
        echoPage();
        renderData();
        await screen.findByText('NULL');
        let release: (v: unknown) => void = () => {};
        api.rows.mockImplementation(
            () => new Promise((resolve) => (release = resolve)),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Next page' }),
            ).toBeDisabled(),
        );
        expect(screen.getByText('Rows 1–1')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Previous page' }),
        ).toBeDisabled();
        expect(
            screen.getByRole('button', { name: 'Open in SQL' }),
        ).toBeDisabled();
        release(page({ page: 2 }));
        await screen.findByText('Rows 101–101');
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
