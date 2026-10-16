import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowse, type TableTab } from '@/browse/browse-store';
import { rowsCache } from '@/browse/rows-cache';
import type { RowFilter, RowsResponse } from '@/lib/workspace-api';
import type { QueryCell, RowCountSchema } from '@/types/schema';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';

const api = vi.hoisted(() => ({ rows: vi.fn(), count: vi.fn() }));
vi.mock('@/lib/workspace-api', async (orig) => ({
    ...(await orig<typeof import('@/lib/workspace-api')>()),
    workspaceApi: {
        ...api,
        schema: vi.fn(),
        refresh: vi.fn(),
        layout: vi.fn(),
        saveLayout: vi.fn(),
        ddl: vi.fn(),
        sample: vi.fn(),
    },
}));

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
    toast: { error: toastError, success: vi.fn() },
}));

// A lightweight stand-in for the lazily imported react-data-grid wrapper.
vi.mock('@/components/grid/result-grid', () => ({
    ResultGrid: (props: {
        rows: QueryCell[][];
        onFilterColumn?: (column: string) => void;
        onOpenRow?: (rowIndex: number) => void;
        onOpenForeign?: (table: string, column: string, value: string) => void;
        activeRow?: number | null;
        layout?: {
            value: { widths: Record<string, number>; hidden: string[] };
            onChange: (next: {
                widths: Record<string, number>;
                hidden: string[];
            }) => void;
        };
    }) => (
        <div data-testid="grid">
            <span>{`${props.rows.length} rows`}</span>
            <span data-testid="first-cell">{String(props.rows[0]?.[0])}</span>
            <span data-testid="active-row">{String(props.activeRow)}</span>
            <button
                type="button"
                onClick={() => props.onFilterColumn?.('name')}
            >
                Filter name
            </button>
            <button type="button" onClick={() => props.onOpenRow?.(2)}>
                Open row 2
            </button>
            <button
                type="button"
                onClick={() =>
                    props.layout?.onChange({
                        ...props.layout.value,
                        widths: { id: 240 },
                    })
                }
            >
                Resize id
            </button>
            {[0, 1, 2, 3].map((i) => (
                <button
                    key={i}
                    type="button"
                    aria-label="Open row"
                    data-row-index={i}
                    onClick={() => props.onOpenRow?.(i)}
                />
            ))}
            <button
                type="button"
                onClick={() => props.onOpenForeign?.('users', 'id', '3')}
            >
                Open FK
            </button>
        </div>
    ),
}));

import { DataView } from './data-view';

const nameColumn = {
    name: 'name',
    type: 'varchar(255)',
    type_name: 'varchar',
    nullable: true,
    default: null,
    auto_increment: false,
    comment: null,
};

const snapshotWith = (rowCount: RowCountSchema, driver = 'mysql') =>
    makeSnapshot(
        [
            {
                name: 'orders',
                row_count: rowCount,
                columns: [
                    {
                        name: 'id',
                        type: 'int',
                        type_name: 'int',
                        nullable: false,
                        default: null,
                        auto_increment: true,
                        comment: null,
                    },
                    nameColumn,
                ],
            },
            { name: 'users', row_count: rowCount, columns: [nameColumn] },
        ],
        [],
        driver,
    );

const page = (
    n: number,
    first: QueryCell,
    over: Partial<RowsResponse> = {},
): RowsResponse => ({
    columns: [
        { name: 'id', type: 'int', table: 'orders' },
        { name: 'name', type: 'varchar', table: 'orders' },
    ],
    rows: Array.from({ length: 100 }, (_, i) => [i === 0 ? first : i + 1, 'x']),
    has_more: true,
    page: n,
    per_page: 100,
    sql: 'select * from `orders` limit 100',
    ...over,
});

const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const requestKey = (filters: RowFilter[], p = 1) =>
    JSON.stringify({ filters, sort: [], page: p, perPage: 100 });

function Harness({
    rowCount = { count: 10, kind: 'exact' },
    table = 'orders',
    onOpenTable = vi.fn(),
}: {
    rowCount?: RowCountSchema;
    table?: string;
    onOpenTable?: (table: string, filters: RowFilter[]) => void;
}) {
    const tab = useBrowse((s) =>
        s.byConnection[1]?.tabs.find((t) => t.id === `t:${table}`),
    ) as TableTab;
    const snapshot = snapshotWith(rowCount);
    return (
        <DataView
            connectionId={1}
            snapshot={snapshot}
            table={snapshot.tables.find((t) => t.name === table)!}
            tab={tab}
            onOpenTable={onOpenTable}
        />
    );
}

const open = (table = 'orders', filters: RowFilter[] = []) =>
    useBrowse
        .getState()
        .openTable(1, table, { mode: 'preview', state: { filters } });

const tabState = (table = 'orders') =>
    (
        useBrowse
            .getState()
            .byConnection[1].tabs.find((t) => t.id === `t:${table}`) as TableTab
    ).state;

beforeEach(() => {
    useBrowse.setState({ byConnection: {} });
    rowsCache.clear();
    api.rows.mockReset();
    api.count.mockReset();
    toastError.mockReset();
    api.rows.mockResolvedValue(page(1, 1));
    api.count.mockResolvedValue({ count: 10, kind: 'exact' });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('DataView', () => {
    it('renders cached rows for an unchanged request without fetching', async () => {
        open();
        rowsCache.set('1:orders', {
            requestKey: requestKey([]),
            rows: page(1, 'cached', { rows: [['cached', 'a']] }),
            total: { count: 1, exact: true },
            scrollTop: 0,
        });
        render(<Harness />);
        expect(await screen.findByText('1 rows')).toBeInTheDocument();
        expect(screen.getByTestId('first-cell')).toHaveTextContent('cached');
        expect(screen.getByText('Rows 1–1 of 1')).toBeInTheDocument();
        expect(api.rows).not.toHaveBeenCalled();
        expect(api.count).not.toHaveBeenCalled();
    });

    it('fetches the first page and stores it in the cache', async () => {
        open();
        render(<Harness />);
        expect(await screen.findByText('100 rows')).toBeInTheDocument();
        expect(api.rows).toHaveBeenCalledWith(
            1,
            'orders',
            { filters: [], sort: [], page: 1, per_page: 100 },
            expect.any(AbortSignal),
        );
        expect(rowsCache.get('1:orders')?.requestKey).toBe(requestKey([]));
        // An exact catalogue count needs no count request.
        expect(api.count).not.toHaveBeenCalled();
        expect(screen.getByText('Rows 1–100 of 10')).toBeInTheDocument();
    });

    it('shows the estimate immediately and counts small tables automatically', async () => {
        open();
        const counted = deferred<{ count: number; kind: 'exact' }>();
        api.count.mockReturnValue(counted.promise);
        render(<Harness rowCount={{ count: 120, kind: 'estimate' }} />);
        expect(await screen.findByText('Rows 1–100 of ~120')).toBeVisible();
        expect(api.count).toHaveBeenCalledWith(
            1,
            'orders',
            { filters: [], exact: false },
            expect.any(AbortSignal),
        );
        await act(async () => counted.resolve({ count: 123, kind: 'exact' }));
        expect(await screen.findByText('Rows 1–100 of 123')).toBeVisible();
        expect(
            screen.queryByRole('button', { name: 'Count exactly' }),
        ).not.toBeInTheDocument();
    });

    it('asks for a capped count when filtered and shows N+ on timeout', async () => {
        const filters: RowFilter[] = [
            { column: 'name', op: 'contains', value: 'a' },
        ];
        open('orders', filters);
        api.count.mockResolvedValue({ count: null, kind: 'timeout' });
        render(<Harness />);
        expect(await screen.findByText('Rows 1–100 of 100+')).toBeVisible();
        expect(api.count).toHaveBeenCalledWith(
            1,
            'orders',
            { filters, exact: false },
            expect.any(AbortSignal),
        );
        api.count.mockResolvedValue({ count: 4321, kind: 'exact' });
        fireEvent.click(screen.getByRole('button', { name: 'Count exactly' }));
        expect(api.count).toHaveBeenLastCalledWith(
            1,
            'orders',
            { filters, exact: true },
            expect.any(AbortSignal),
        );
        expect(await screen.findByText('Rows 1–100 of 4,321')).toBeVisible();
    });

    it('keeps the previous total and toasts when the exact count fails', async () => {
        open('orders', [{ column: 'name', op: 'contains', value: 'a' }]);
        api.count.mockResolvedValue({ count: null, kind: 'timeout' });
        render(<Harness />);
        await screen.findByText('Rows 1–100 of 100+');
        api.count.mockRejectedValue(new Error('boom'));
        fireEvent.click(screen.getByRole('button', { name: 'Count exactly' }));
        await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(screen.getByText('Rows 1–100 of 100+')).toBeVisible();
    });

    it('shows the range without a total when the count fails', async () => {
        open('orders', [{ column: 'name', op: 'contains', value: 'a' }]);
        api.count.mockRejectedValue(new Error('nope'));
        render(<Harness />);
        expect(await screen.findByText('count unavailable')).toBeVisible();
        expect(screen.getByText('Rows 1–100')).toBeVisible();
    });

    it('ignores a slow response for a previous page', async () => {
        open();
        const slow = deferred<RowsResponse>();
        api.rows
            .mockReturnValueOnce(slow.promise)
            .mockResolvedValueOnce(page(2, 'B'));
        render(<Harness />);
        expect(api.rows).toHaveBeenCalledTimes(1);
        // The user moves to page 2 before page 1 has answered.
        act(() => useBrowse.getState().updateTable(1, 't:orders', { page: 2 }));
        expect(await screen.findByText('Rows 101–200 of 10')).toBeVisible();
        expect(screen.getByTestId('first-cell')).toHaveTextContent('B');
        await act(async () => slow.resolve(page(1, 'A')));
        expect(screen.getByTestId('first-cell')).toHaveTextContent('B');
        expect(screen.getByText('Rows 101–200 of 10')).toBeVisible();
        expect(rowsCache.get('1:orders')?.requestKey).toBe(requestKey([], 2));
    });

    it('ignores a slow response for a previous table', async () => {
        useBrowse.getState().openTable(1, 'orders', { mode: 'permanent' });
        useBrowse.getState().openTable(1, 'users', { mode: 'permanent' });
        const slow = deferred<RowsResponse>();
        api.rows
            .mockReturnValueOnce(slow.promise)
            .mockResolvedValueOnce(page(1, 'U'));
        const { rerender } = render(<Harness table="orders" />);
        rerender(<Harness table="users" />);
        expect(await screen.findByText('100 rows')).toBeVisible();
        expect(screen.getByTestId('first-cell')).toHaveTextContent('U');
        await act(async () => slow.resolve(page(1, 'A')));
        expect(screen.getByTestId('first-cell')).toHaveTextContent('U');
        expect(rowsCache.get('1:orders')).toBeUndefined();
    });

    it('moves between pages from the footer', async () => {
        open();
        render(<Harness />);
        await screen.findByText('Rows 1–100 of 10');
        api.rows.mockResolvedValue(page(2, 'B', { has_more: false }));
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(tabState().page).toBe(2);
        await screen.findByText('Rows 101–200 of 10');
        expect(
            screen.getByRole('button', { name: 'Next page' }),
        ).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Rows per page'), {
            target: { value: '500' },
        });
        expect(tabState()).toMatchObject({ perPage: 500, page: 1 });
    });

    it('resets to page 1 and promotes the tab when filters change', async () => {
        useBrowse.getState().openTable(1, 'orders', {
            mode: 'preview',
            state: { page: 3 },
        });
        api.rows.mockResolvedValue(page(3, 1));
        render(<Harness />);
        await screen.findByText('100 rows');
        const tabBefore = useBrowse
            .getState()
            .byConnection[1].tabs.find((t) => t.id === 't:orders') as TableTab;
        expect(tabBefore.preview).toBe(true);
        fireEvent.change(screen.getByLabelText('Filter value'), {
            target: { value: '7' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
        const tab = useBrowse
            .getState()
            .byConnection[1].tabs.find((t) => t.id === 't:orders') as TableTab;
        expect(tab.state.page).toBe(1);
        expect(tab.state.filters).toEqual([
            { column: 'id', op: 'eq', value: '7' },
        ]);
        expect(tab.preview).toBe(false);
    });

    it('promotes a preview tab when a column is resized', async () => {
        open();
        render(<Harness />);
        await screen.findByText('100 rows');
        fireEvent.click(screen.getByRole('button', { name: 'Resize id' }));
        const tab = useBrowse
            .getState()
            .byConnection[1].tabs.find((t) => t.id === 't:orders') as TableTab;
        expect(tab.preview).toBe(false);
    });

    it('promotes a preview tab when a row is opened in the drawer', async () => {
        open();
        render(<Harness />);
        await screen.findByText('100 rows');
        fireEvent.click(screen.getByRole('button', { name: 'Open row 2' }));
        const tab = useBrowse
            .getState()
            .byConnection[1].tabs.find((t) => t.id === 't:orders') as TableTab;
        expect(tab.preview).toBe(false);
        expect(tab.state.drawerRow).toBe(2);
    });

    it('starts a filter draft from a header filter click', async () => {
        open();
        render(<Harness />);
        await screen.findByText('100 rows');
        fireEvent.click(screen.getByRole('button', { name: 'Filter name' }));
        expect(screen.getByLabelText('Filter column')).toHaveValue('name');
        expect(screen.getByLabelText('Filter value')).toHaveFocus();
    });

    it('opens a table filtered on the FK value', async () => {
        open();
        const onOpenTable = vi.fn();
        render(<Harness onOpenTable={onOpenTable} />);
        await screen.findByText('100 rows');
        fireEvent.click(screen.getByRole('button', { name: 'Open FK' }));
        expect(onOpenTable).toHaveBeenCalledWith('users', [
            { column: 'id', op: 'eq', value: '3' },
        ]);
    });

    it('opens a row in the drawer slot', async () => {
        open();
        render(<Harness />);
        await screen.findByText('100 rows');
        fireEvent.click(screen.getByRole('button', { name: 'Open row 2' }));
        expect(tabState().drawerRow).toBe(2);
        expect(screen.getByTestId('active-row')).toHaveTextContent('2');
    });

    it('steps past the end of a page into the next one', async () => {
        useBrowse.getState().openTable(1, 'orders', {
            mode: 'preview',
            state: { drawerRow: 99 },
        });
        render(<Harness />);
        await screen.findByRole('heading', { level: 3 });
        api.rows.mockResolvedValue(page(2, 'B', { has_more: false }));
        fireEvent.keyDown(screen.getByRole('complementary'), {
            key: 'ArrowDown',
        });
        expect(tabState()).toMatchObject({ page: 2, drawerRow: 0 });
        await screen.findByText('Rows 101–200 of 10');
        expect(
            screen.getByRole('complementary', { name: 'Row details' }),
        ).toBeInTheDocument();
    });

    it('steps back to the previous page and closes on Escape', async () => {
        useBrowse.getState().openTable(1, 'orders', {
            mode: 'preview',
            state: { page: 2, drawerRow: 0 },
        });
        api.rows.mockResolvedValue(page(2, 'B'));
        render(<Harness />);
        await screen.findByRole('heading', { level: 3 });
        fireEvent.keyDown(screen.getByRole('complementary'), {
            key: 'ArrowUp',
        });
        expect(tabState()).toMatchObject({ page: 1, drawerRow: 99 });
        await waitFor(() =>
            expect(screen.getByRole('complementary')).not.toHaveAttribute(
                'aria-busy',
            ),
        );
        fireEvent.keyDown(screen.getByRole('complementary'), {
            key: 'Escape',
        });
        expect(tabState().drawerRow).toBeNull();
    });

    it('returns focus to the button of the row that was open', async () => {
        useBrowse.getState().openTable(1, 'orders', {
            mode: 'preview',
            state: { drawerRow: 3 },
        });
        render(<Harness />);
        await screen.findByRole('heading', { level: 3 });
        fireEvent.click(
            screen.getByRole('button', { name: 'Close row details' }),
        );
        await waitFor(() =>
            expect(
                document.querySelector('button[data-row-index="3"]'),
            ).toHaveFocus(),
        );
    });

    it('clears the drawer row when it is past a short page', async () => {
        useBrowse.getState().openTable(1, 'orders', {
            mode: 'preview',
            state: { drawerRow: 50 },
        });
        api.rows.mockResolvedValue(
            page(1, 1, { rows: [[1, 'x']], has_more: false }),
        );
        render(<Harness />);
        await screen.findByText('1 rows');
        await waitFor(() => expect(tabState().drawerRow).toBeNull());
    });

    it('retries after an error', async () => {
        open();
        api.rows.mockRejectedValueOnce(new Error('down'));
        render(<Harness />);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Could not load rows.',
        );
        api.rows.mockResolvedValue(page(1, 'R'));
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByText('100 rows')).toBeVisible();
        expect(api.rows).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('lets an interrupted count be resumed from the cache', async () => {
        const filters: RowFilter[] = [
            { column: 'name', op: 'contains', value: 'a' },
        ];
        open('orders', filters);
        api.count.mockReturnValue(new Promise(() => {}));
        const first = render(<Harness />);
        await screen.findByText('100 rows');
        expect(
            screen.queryByRole('button', { name: 'Count exactly' }),
        ).not.toBeInTheDocument();
        first.unmount();
        api.rows.mockClear();
        api.count.mockReset();
        api.count.mockResolvedValue({ count: 250, kind: 'exact' });
        render(<Harness />);
        expect(await screen.findByText('Rows 1–100')).toBeVisible();
        expect(api.rows).not.toHaveBeenCalled();
        expect(api.count).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Count exactly' }));
        expect(api.count).toHaveBeenCalledWith(
            1,
            'orders',
            { filters, exact: true },
            expect.any(AbortSignal),
        );
        expect(await screen.findByText('Rows 1–100 of 250')).toBeVisible();
    });

    it('keeps "count unavailable" across a cache round trip and offers an exact count', async () => {
        open('orders', [{ column: 'name', op: 'contains', value: 'a' }]);
        api.count.mockRejectedValue(new Error('nope'));
        const first = render(<Harness />);
        expect(await screen.findByText('count unavailable')).toBeVisible();
        expect(
            screen.getByRole('button', { name: 'Count exactly' }),
        ).toBeVisible();
        first.unmount();
        api.count.mockClear();
        render(<Harness />);
        expect(await screen.findByText('count unavailable')).toBeVisible();
        expect(api.count).not.toHaveBeenCalled();
    });

    it("never writes a new request's total into the previous entry", async () => {
        open();
        render(<Harness rowCount={{ count: 120, kind: 'estimate' }} />);
        await screen.findByText('Rows 1–100 of 10');
        api.rows.mockReturnValue(new Promise(() => {}));
        api.count.mockResolvedValue({ count: 5, kind: 'exact' });
        act(() =>
            useBrowse.getState().updateTable(1, 't:orders', {
                filters: [{ column: 'name', op: 'eq', value: 'z' }],
            }),
        );
        await vi.waitFor(() => expect(api.count).toHaveBeenCalledTimes(2));
        await act(async () => {});
        expect(rowsCache.get('1:orders')?.total).toEqual({
            count: 10,
            exact: true,
        });
        expect(
            screen.getByRole('button', { name: 'Next page' }),
        ).toBeDisabled();
    });
});
