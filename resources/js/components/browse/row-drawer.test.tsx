import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordPayload, RelationshipSummary } from '@/records/types';
import type { QueryCell, QueryColumn } from '@/types/schema';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';

const api = vi.hoisted(() => ({ show: vi.fn(), related: vi.fn() }));
vi.mock('@/records/records-api', () => ({ recordsApi: api }));

import { RowDrawer } from './row-drawer';

const idColumn = {
    name: 'id',
    type: 'integer',
    type_name: 'integer',
    nullable: false,
    default: null,
    auto_increment: true,
    comment: null,
};
const plain = (name: string, type = 'text') => ({
    ...idColumn,
    name,
    type,
    type_name: type,
    nullable: true,
    auto_increment: false,
});

const snapshot = makeSnapshot(
    [
        {
            name: 'orders',
            columns: [idColumn, plain('user_id', 'integer'), plain('note')],
        },
        { name: 'users', columns: [idColumn, plain('name')] },
        { name: 'order_items', columns: [idColumn, plain('order_id')] },
        {
            name: 'recent_orders',
            kind: 'view',
            primary_key: [],
            columns: [idColumn, plain('note')],
        },
        {
            name: 'logs',
            primary_key: [],
            columns: [plain('message')],
        },
    ],
    [
        {
            id: 'r1',
            from_table: 'orders',
            from_columns: ['user_id'],
            to_table: 'users',
            to_columns: ['id'],
        },
        {
            id: 'r2',
            from_table: 'order_items',
            from_columns: ['order_id'],
            to_table: 'orders',
            to_columns: ['id'],
        },
    ],
);

const col = (table: string, name: string, type = 'int'): QueryColumn => ({
    name,
    type,
    table,
});

const relationships: RelationshipSummary[] = [
    {
        id: 'r1',
        direction: 'out',
        table: 'users',
        columns: ['user_id'],
        other_columns: ['id'],
        inferred: false,
        available: true,
        count: null,
    },
    {
        id: 'r2',
        direction: 'in',
        table: 'order_items',
        columns: ['id'],
        other_columns: ['order_id'],
        inferred: false,
        available: true,
        count: { value: 12, capped: false },
    },
];

const ordersPayload: RecordPayload = {
    table: 'orders',
    key: { id: 1 },
    columns: [
        { name: 'id', type: 'integer' },
        { name: 'user_id', type: 'integer' },
        { name: 'note', type: 'text' },
    ],
    values: [1, 3, 'hi'],
    relationships,
};

type Over = Partial<React.ComponentProps<typeof RowDrawer>>;

function setup(over: Over = {}) {
    const props = {
        connectionId: 1,
        snapshot,
        table: snapshot.tables.find((t) => t.name === 'orders')!,
        columns: [
            col('orders', 'id'),
            col('orders', 'user_id'),
            col('orders', 'note', 'text'),
        ],
        row: [1, 3, 'hi'] as QueryCell[],
        onClose: vi.fn(),
        onStep: vi.fn(),
        onOpenTable: vi.fn(),
        onExplore: vi.fn(),
        ...over,
    };
    return { props, ...render(<RowDrawer {...props} />) };
}

beforeEach(() => {
    api.show.mockReset();
    api.related.mockReset();
    api.show.mockResolvedValue(ordersPayload);
});

describe('RowDrawer', () => {
    it('shows field values with NULL and pretty JSON', async () => {
        setup({
            table: snapshot.tables.find((t) => t.name === 'orders')!,
            columns: [
                col('orders', 'id'),
                col('orders', 'profile', 'json'),
                col('orders', 'note', 'text'),
            ],
            row: [1, '{"a":1}', null],
        });
        expect(screen.getByText('NULL')).toBeInTheDocument();
        expect(document.querySelector('pre')?.textContent).toContain('"a": 1');
        expect(
            screen.getByRole('complementary', { name: 'Row details' }),
        ).toBeInTheDocument();
        await screen.findByText('Explore graph');
    });

    it('toggles a JSON value between pretty-printed and compact', async () => {
        setup({
            columns: [col('orders', 'id'), col('orders', 'profile', 'json')],
            row: [1, '{"a":1,"b":[2]}'],
        });
        const pre = () => document.querySelector('pre')?.textContent;
        expect(pre()).toContain('"a": 1');
        const toggle = screen.getByRole('button', {
            name: 'Pretty-print profile',
        });
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(toggle);
        expect(pre()).toBe('{"a":1,"b":[2]}');
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(toggle);
        expect(pre()).toContain('"a": 1');
        await screen.findByText('Explore graph');
    });

    it('moves focus to the heading on open', async () => {
        setup();
        expect(screen.getByRole('heading', { level: 3 })).toHaveFocus();
        await screen.findByText('Explore graph');
    });

    it('collapses long values behind Show all', async () => {
        const long = Array.from({ length: 12 }, (_, i) => `line ${i}`).join(
            '\n',
        );
        setup({ row: [1, 3, long] });
        const pre = document.querySelector('pre')!;
        expect(pre.className).toContain('overflow-hidden');
        fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
        expect(pre.className).not.toContain('overflow-hidden');
        await screen.findByText('Explore graph');
    });

    it('lists references and referenced-by counts for an explorable row', async () => {
        setup();
        expect(
            await screen.findByRole('button', { name: 'users · user_id' }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'order_items (12)' }),
        ).toBeInTheDocument();
        expect(api.show).toHaveBeenCalledWith(
            1,
            'orders',
            { id: 1 },
            expect.any(AbortSignal),
        );
        expect(
            screen.getByRole('heading', { name: 'orders · 1' }),
        ).toBeInTheDocument();
    });

    it('appends + to a capped count', async () => {
        api.show.mockResolvedValue({
            ...ordersPayload,
            relationships: [
                {
                    ...relationships[1],
                    count: { value: 1000, capped: true },
                },
            ],
        });
        setup();
        expect(
            await screen.findByRole('button', { name: 'order_items (1000+)' }),
        ).toBeInTheDocument();
    });

    it('hops to a referenced record and back', async () => {
        api.related.mockResolvedValue({
            table: 'users',
            columns: [],
            primary_key: ['id'],
            rows: [{ key: { id: 3 }, values: [3, 'Ann'] }],
            next_cursor: null,
        });
        api.show.mockImplementation((_id, table) =>
            Promise.resolve(
                table === 'users'
                    ? {
                          table: 'users',
                          key: { id: 3 },
                          columns: [
                              { name: 'id', type: 'integer' },
                              { name: 'name', type: 'text' },
                          ],
                          values: [3, 'Ann'],
                          relationships: [],
                      }
                    : ordersPayload,
            ),
        );
        setup();
        const reference = await screen.findByRole('button', {
            name: 'users · user_id',
        });
        reference.focus();
        fireEvent.click(reference);
        expect(api.related).toHaveBeenCalledWith(
            1,
            'orders',
            { id: 1 },
            { rel: 'r1', dir: 'out', limit: 1 },
            expect.any(AbortSignal),
        );
        expect(
            await screen.findByRole('heading', { name: 'users · 3' }),
        ).toBeInTheDocument();
        expect(await screen.findByText('Ann')).toBeInTheDocument();
        // The clicked reference is gone: focus stays in the drawer (on its heading), so Escape still closes it.
        expect(screen.getByRole('heading', { level: 3 })).toHaveFocus();
        const back = screen.getByRole('button', { name: 'Back' });
        back.focus();
        fireEvent.click(back);
        expect(
            screen.getByRole('heading', { name: 'orders · 1' }),
        ).toBeInTheDocument();
        // Back unmounts itself; focus moves to the heading instead of falling to <body>.
        expect(screen.getByRole('heading', { level: 3 })).toHaveFocus();
        expect(
            screen.queryByRole('button', { name: 'Back' }),
        ).not.toBeInTheDocument();
    });

    it('drops a hop that resolves after Back', async () => {
        const hopped = {
            table: 'users',
            key: { id: 3 },
            columns: [{ name: 'id', type: 'integer' }],
            values: [3],
            relationships: [{ ...relationships[0], id: 'r9', table: 'orders' }],
        };
        api.show.mockImplementation((_id, table) =>
            Promise.resolve(table === 'users' ? hopped : ordersPayload),
        );
        api.related.mockResolvedValueOnce({
            table: 'users',
            columns: [],
            primary_key: ['id'],
            rows: [{ key: { id: 3 }, values: [3] }],
            next_cursor: null,
        });
        setup();
        fireEvent.click(
            await screen.findByRole('button', { name: 'users · user_id' }),
        );
        await screen.findByRole('heading', { name: 'users · 3' });
        let resolveLate!: (v: unknown) => void;
        api.related.mockReturnValueOnce(
            new Promise((res) => (resolveLate = res)),
        );
        fireEvent.click(
            await screen.findByRole('button', { name: 'orders · user_id' }),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        resolveLate({
            table: 'orders',
            columns: [],
            primary_key: ['id'],
            rows: [{ key: { id: 9 }, values: [9] }],
            next_cursor: null,
        });
        await new Promise((r) => setTimeout(r, 0));
        expect(
            screen.getByRole('heading', { name: 'orders · 1' }),
        ).toBeInTheDocument();
    });

    it('opens the referencing table filtered to this row', async () => {
        const { props } = setup();
        fireEvent.click(
            await screen.findByRole('button', { name: 'order_items (12)' }),
        );
        expect(props.onOpenTable).toHaveBeenCalledWith('order_items', [
            { column: 'order_id', op: 'eq', value: '1' },
        ]);
    });

    it('converts referencing values like the grid and skips non-scalar ones', async () => {
        const { props, unmount } = setup({ row: [true, 3, 'hi'] });
        fireEvent.click(
            await screen.findByRole('button', { name: 'order_items (12)' }),
        );
        expect(props.onOpenTable).toHaveBeenCalledWith('order_items', [
            { column: 'order_id', op: 'eq', value: 'true' },
        ]);
        unmount();

        // A relationship on a JSON column cannot be turned into a filter.
        const withNotes = makeSnapshot(
            [
                ...snapshot.tables,
                { name: 'order_notes', columns: [idColumn, plain('note')] },
            ],
            [
                ...snapshot.relationships,
                {
                    id: 'r3',
                    from_table: 'order_notes',
                    from_columns: ['note'],
                    to_table: 'orders',
                    to_columns: ['note'],
                },
            ],
        );
        api.show.mockResolvedValue({
            ...ordersPayload,
            relationships: [
                ...relationships,
                {
                    id: 'r3',
                    direction: 'in',
                    table: 'order_notes',
                    columns: ['note'],
                    other_columns: ['note'],
                    inferred: false,
                    available: true,
                    count: null,
                },
            ],
        });
        setup({
            snapshot: withNotes,
            row: [1, 3, { x: 1 } as unknown as QueryCell],
        });
        expect(
            await screen.findByRole('button', { name: 'order_notes' }),
        ).toBeDisabled();
        expect(
            screen.getByRole('button', { name: 'order_items (12)' }),
        ).toBeEnabled();
    });

    it('explores the graph from the current record', async () => {
        const { props } = setup();
        fireEvent.click(
            await screen.findByRole('button', { name: 'Explore graph' }),
        );
        expect(props.onExplore).toHaveBeenCalledWith({
            table: 'orders',
            key: { id: 1 },
        });
    });

    it('shows values only for a view', () => {
        setup({
            table: snapshot.tables.find((t) => t.name === 'recent_orders')!,
            columns: [col('recent_orders', 'id'), col('recent_orders', 'note')],
            row: [7, 'seen'],
            rowNumber: 4,
        });
        expect(api.show).not.toHaveBeenCalled();
        expect(
            screen.getByText(
                'Relations are available for tables with a primary key.',
            ),
        ).toBeInTheDocument();
        expect(screen.getByText('seen')).toBeInTheDocument();
        expect(
            screen.getByRole('heading', { name: 'recent_orders · row 4' }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Explore graph' }),
        ).not.toBeInTheDocument();
    });

    it('shows values only for a table without a primary key', () => {
        setup({
            table: snapshot.tables.find((t) => t.name === 'logs')!,
            columns: [col('logs', 'message', 'text')],
            row: ['boot'],
            rowNumber: 2,
        });
        expect(api.show).not.toHaveBeenCalled();
        expect(
            screen.getByText(
                'Relations are available for tables with a primary key.',
            ),
        ).toBeInTheDocument();
        expect(screen.getByText('boot')).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Explore graph' }),
        ).not.toBeInTheDocument();
    });

    it('steps with the arrow keys and closes with Escape', async () => {
        const { props } = setup();
        const drawer = screen.getByRole('complementary');
        fireEvent.keyDown(drawer, { key: 'ArrowDown' });
        expect(props.onStep).toHaveBeenCalledWith(1);
        fireEvent.keyDown(drawer, { key: 'ArrowUp' });
        expect(props.onStep).toHaveBeenLastCalledWith(-1);
        const outer = vi.fn();
        document.addEventListener('keydown', outer);
        fireEvent.keyDown(drawer, { key: 'Escape' });
        document.removeEventListener('keydown', outer);
        expect(props.onClose).toHaveBeenCalledTimes(1);
        expect(outer).not.toHaveBeenCalled();
        await screen.findByText('Explore graph');
    });

    it('ignores a stale record response after the row changes', async () => {
        let resolveFirst!: (p: RecordPayload) => void;
        api.show
            .mockReturnValueOnce(
                new Promise<RecordPayload>((res) => (resolveFirst = res)),
            )
            .mockResolvedValueOnce({
                ...ordersPayload,
                key: { id: 2 },
                relationships: [],
            });
        const first = setup();
        first.rerender(<RowDrawer {...first.props} row={[2, 3, 'hi']} />);
        await screen.findByRole('heading', { name: 'orders · 2' });
        resolveFirst(ordersPayload);
        await waitFor(() =>
            expect(
                screen.queryByRole('button', { name: 'users · user_id' }),
            ).not.toBeInTheDocument(),
        );
    });
});
