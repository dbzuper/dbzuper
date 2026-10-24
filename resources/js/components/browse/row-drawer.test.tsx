import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordPayload, RelationshipSummary } from '@/records/types';
import type { QueryCell, QueryColumn } from '@/types/schema';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';

const api = vi.hoisted(() => ({ show: vi.fn(), related: vi.fn() }));
vi.mock('@/records/records-api', () => ({ recordsApi: api }));

const toast = vi.hoisted(() =>
    Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));

import { ResultGrid } from '@/components/grid/result-grid';
import { flushOpenEdits } from '@/editing/flush-edits';
import { refOf, usePending } from '@/editing/pending-store';
import type { GridEditing } from '@/editing/row-edit';
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

describe('RowDrawer editing', () => {
    const editColumns: QueryColumn[] = [
        col('orders', 'id', 'integer'),
        col('orders', 'user_id', 'integer'),
        col('orders', 'note', 'text'),
        col('orders', 'meta', 'json'),
        col('orders', 'score', 'float'),
        col('orders', 'flag', 'boolean'),
    ];
    const editRow: QueryCell[] = [
        1,
        3,
        'line one\r\nline two',
        '{"a":1}',
        1.5,
        true,
    ];
    const editing = (over: Partial<GridEditing> = {}): GridEditing => ({
        connectionId: 1,
        table: 'orders',
        dialect: 'pgsql',
        rowIds: [{ key: { id: 1 } }],
        locked: [[4]],
        shortened: [[]],
        readOnlyColumns: [],
        rowReason: null,
        tableColumns: [],
        ...over,
    });
    const ref = refOf({ key: { id: 1 } });
    const pending = () => usePending.getState().byTable['1:orders'] ?? {};
    const setupEdit = (over: Over = {}) =>
        setup({
            columns: editColumns,
            row: editRow,
            editing: editing(),
            rowIndex: 0,
            ...over,
        });
    const field = (name: string) => screen.getByRole('textbox', { name });

    beforeEach(() => usePending.setState({ byTable: {}, errors: {} }));

    it('stages a field on blur, labels it edited with its original, and reverts it', () => {
        setupEdit();
        const userId = field('user_id');
        expect(userId).toHaveValue('3');
        fireEvent.change(userId, { target: { value: '4' } });
        // A draft is not staged until the field is left.
        expect(pending()).toEqual({});
        fireEvent.blur(userId);
        expect(pending()[ref]).toMatchObject({
            kind: 'update',
            values: { user_id: '4' },
            original: { id: 1, user_id: 3 },
        });
        expect(field('user_id')).toHaveValue('4');
        expect(screen.getByText('Original: 3')).toBeInTheDocument();
        expect(screen.getAllByText('edited').length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Revert user_id' }));
        expect(pending()).toEqual({});
    });

    it('shows a drawer edit in the grid as an edited cell', () => {
        // Only the first columns render in jsdom: the edited one comes first.
        const gridColumns = [
            col('orders', 'note', 'text'),
            col('orders', 'id', 'integer'),
        ];
        const gridEditing = editing({ locked: [[]] });
        render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid
                    columns={gridColumns}
                    rows={[['hi', 1]]}
                    editing={gridEditing}
                />
            </div>,
        );
        setup({
            columns: gridColumns,
            row: ['hi', 1],
            editing: gridEditing,
            rowIndex: 0,
        });
        const note = field('note');
        fireEvent.change(note, { target: { value: 'hello' } });
        fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true });
        const cell = screen.getByRole('gridcell', { name: /hello/ });
        expect(cell).toHaveClass('rdg-cell-edited');
    });

    it('edits multi-line text in a textarea and keeps its line ends', () => {
        setupEdit();
        const note = field('note');
        expect(note.tagName).toBe('TEXTAREA');
        // Enter is a new line in a multi-line field, not a commit.
        fireEvent.change(note, {
            target: { value: 'line one\nline two\nline three' },
        });
        fireEvent.keyDown(note, { key: 'Enter' });
        expect(pending()).toEqual({});
        fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true });
        expect(pending()[ref]).toMatchObject({
            values: { note: 'line one\r\nline two\r\nline three' },
        });
    });

    it('stages a single-line field on Enter and cancels a draft with Escape before closing', () => {
        const { props } = setupEdit();
        const id = field('id');
        expect(id.tagName).toBe('INPUT');
        fireEvent.change(id, { target: { value: '9' } });
        fireEvent.keyDown(id, { key: 'Escape' });
        expect(id).toHaveValue('1');
        expect(props.onClose).not.toHaveBeenCalled();
        fireEvent.keyDown(id, { key: 'Escape' });
        expect(props.onClose).toHaveBeenCalledTimes(1);
        fireEvent.change(id, { target: { value: '9' } });
        fireEvent.keyDown(id, { key: 'Enter' });
        expect(pending()[ref]).toMatchObject({ values: { id: '9' } });
    });

    it('validates JSON before staging and ties the error to the field', () => {
        setupEdit();
        const meta = field('meta');
        expect(meta.tagName).toBe('TEXTAREA');
        fireEvent.change(meta, { target: { value: '{"a":' } });
        fireEvent.blur(meta);
        expect(pending()).toEqual({});
        expect(meta).toHaveAttribute('aria-invalid', 'true');
        const error = screen.getByRole('alert');
        expect(error).toHaveTextContent(/^Invalid JSON/);
        expect(meta.getAttribute('aria-describedby')).toContain(error.id);
        fireEvent.change(meta, { target: { value: '{"a":2}' } });
        fireEvent.blur(meta);
        expect(pending()[ref]).toMatchObject({ values: { meta: '{"a":2}' } });
        expect(meta).not.toHaveAttribute('aria-invalid');
    });

    it('says an invalid JSON draft was not staged when the drawer leaves the row', () => {
        toast.error.mockReset();
        const { unmount } = setupEdit();
        fireEvent.change(field('meta'), { target: { value: '{"a":' } });
        unmount();
        expect(pending()).toEqual({});
        expect(toast.error).toHaveBeenCalledWith(
            'meta: invalid JSON, not staged',
        );
    });

    it('says nothing when the drawer leaves with no draft or a valid one', () => {
        toast.error.mockReset();
        const { unmount } = setupEdit();
        fireEvent.change(field('meta'), { target: { value: '{"a":3}' } });
        unmount();
        expect(pending()[ref]).toMatchObject({ values: { meta: '{"a":3}' } });
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('keeps a locked field read-only and says why, like the grid', () => {
        setupEdit();
        expect(
            screen.queryByRole('textbox', { name: 'score' }),
        ).not.toBeInTheDocument();
        expect(
            screen.getByText(
                "Not editable: its values can't be compared exactly",
            ),
        ).toBeInTheDocument();
    });

    it('keeps a value with mixed line ends read-only', () => {
        setupEdit({ row: [1, 3, 'a\r\nb\nc', '{}', 1.5, true] });
        expect(
            screen.queryByRole('textbox', { name: 'note' }),
        ).not.toBeInTheDocument();
        expect(
            screen.getByText(/Not editable: mixed line ends/),
        ).toBeInTheDocument();
    });

    it('sets a field to NULL and toggles a boolean per engine', () => {
        setupEdit();
        fireEvent.click(
            screen.getByRole('button', { name: 'Set user_id to NULL' }),
        );
        fireEvent.click(screen.getByRole('checkbox', { name: 'flag' }));
        expect(pending()[ref]).toMatchObject({
            values: { user_id: null, flag: 'false' },
        });
    });

    it('deletes, restores and reverts the row from the header', () => {
        setupEdit();
        fireEvent.click(screen.getByRole('button', { name: 'Delete row' }));
        expect(pending()[ref]).toMatchObject({ kind: 'delete' });
        expect(screen.getByText('Deleted')).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Restore row' }));
        expect(pending()).toEqual({});
        fireEvent.change(field('user_id'), { target: { value: '7' } });
        fireEvent.blur(field('user_id'));
        expect(screen.getByText('Edited')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Revert row' }));
        expect(pending()).toEqual({});
        expect(
            screen.queryByRole('button', { name: 'Revert row' }),
        ).not.toBeInTheDocument();
    });

    it('stages an open draft when Review flushes edits, and before stepping', () => {
        const { props } = setupEdit();
        fireEvent.change(field('user_id'), { target: { value: '5' } });
        act(() => flushOpenEdits());
        expect(pending()[ref]).toMatchObject({ values: { user_id: '5' } });
        fireEvent.change(field('note'), { target: { value: 'x' } });
        fireEvent.keyDown(screen.getByRole('heading', { level: 3 }), {
            key: 'ArrowDown',
        });
        expect(pending()[ref]).toMatchObject({
            values: { user_id: '5', note: 'x' },
        });
        expect(props.onStep).toHaveBeenCalledWith(1);
    });

    it('keeps a row that cannot be pinned read-only, with the reason', () => {
        setupEdit({
            editing: editing({ rowIds: [null], rowReason: 'no key here' }),
        });
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(
            screen.getByText('Not editable: no key here'),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Delete row' }),
        ).not.toBeInTheDocument();
    });

    it('shows a hopped record read-only with Open to edit, filtered on its key', async () => {
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
        const { props } = setupEdit();
        fireEvent.click(
            await screen.findByRole('button', { name: 'users · user_id' }),
        );
        await screen.findByText('Ann');
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Delete row' }),
        ).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Open to edit' }));
        expect(props.onOpenTable).toHaveBeenCalledWith('users', [
            { column: 'id', op: 'eq', value: '3' },
        ]);
    });

    it('offers no Open to edit on a read-only connection', async () => {
        api.related.mockResolvedValue({
            table: 'users',
            columns: [],
            primary_key: ['id'],
            rows: [{ key: { id: 3 }, values: [3, 'Ann'] }],
            next_cursor: null,
        });
        setup({ readOnly: true });
        fireEvent.click(
            await screen.findByRole('button', { name: 'users · user_id' }),
        );
        await screen.findByRole('heading', { name: 'users · 3' });
        expect(
            screen.queryByRole('button', { name: 'Open to edit' }),
        ).not.toBeInTheDocument();
    });
});

describe('RowDrawer date fields', () => {
    const ref = refOf({ key: { id: 1 } });
    const pending = () => usePending.getState().byTable['1:orders'] ?? {};
    const setupDate = () =>
        setup({
            columns: [
                col('orders', 'id', 'integer'),
                col('orders', 'created_at', 'timestamp'),
            ],
            row: [1, '2026-10-01 12:00:00'],
            editing: {
                connectionId: 1,
                table: 'orders',
                dialect: 'pgsql',
                rowIds: [{ key: { id: 1 } }],
                locked: [[]],
                shortened: [[]],
                readOnlyColumns: [],
                rowReason: null,
                tableColumns: [],
            },
            rowIndex: 0,
        });
    const openPicker = async () => {
        const buttons = screen.getAllByRole('button', { name: 'Choose date' });
        // Only the date column has one.
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toHaveAttribute('aria-haspopup', 'dialog');
        fireEvent.click(buttons[0]);
        // The picker is lazy: the first import can be slow in a cold test run.
        return screen.findByRole(
            'button',
            { name: /^15 October 2026/ },
            { timeout: 5000 },
        );
    };

    beforeEach(() => usePending.setState({ byTable: {}, errors: {} }));

    it('stages the picked value on Apply and returns focus to the field', async () => {
        setupDate();
        fireEvent.click(await openPicker());
        fireEvent.change(screen.getByLabelText('Time'), {
            target: { value: '09:30:15' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(pending()[ref]).toMatchObject({
            kind: 'update',
            values: { created_at: '2026-10-15 09:30:15' },
        });
        const field = screen.getByRole('textbox', { name: 'created_at' });
        expect(field).toHaveValue('2026-10-15 09:30:15');
        await waitFor(() => expect(field).toHaveFocus());
    });

    it('opens the picker from the field with Alt+ArrowDown', async () => {
        setupDate();
        const field = screen.getByRole('textbox', { name: 'created_at' });
        expect(field).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowDown');
        fireEvent.keyDown(field, { key: 'ArrowDown', altKey: true });
        expect(
            await screen.findByRole(
                'button',
                { name: /^15 October 2026/ },
                { timeout: 5000 },
            ),
        ).toBeInTheDocument();
    });

    it('closes only the picker on Escape, not the drawer', async () => {
        const { props } = setupDate();
        await openPicker();
        fireEvent.keyDown(screen.getByLabelText('Date'), { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(props.onClose).not.toHaveBeenCalled();
        expect(pending()).toEqual({});
        await waitFor(() =>
            expect(
                screen.getByRole('textbox', { name: 'created_at' }),
            ).toHaveFocus(),
        );
    });
});

describe('RowDrawer clearing a field', () => {
    const ref = refOf({ key: { id: 1 } });
    const pending = () => usePending.getState().byTable['1:orders'] ?? {};
    const setupClear = () =>
        setup({
            columns: [
                col('orders', 'id', 'integer'),
                col('orders', 'created_by', 'integer'),
                col('orders', 'qty', 'integer'),
                col('orders', 'label', 'varchar'),
            ],
            row: [1, 7, 3, 'x'],
            editing: {
                connectionId: 1,
                table: 'orders',
                dialect: 'mysql',
                rowIds: [{ key: { id: 1 } }],
                locked: [[]],
                shortened: [[]],
                readOnlyColumns: [],
                rowReason: null,
                tableColumns: [
                    idColumn,
                    plain('created_by', 'integer'),
                    { ...plain('qty', 'integer'), nullable: false },
                    plain('label', 'varchar'),
                ],
            },
            rowIndex: 0,
        });
    const field = (name: string) => screen.getByRole('textbox', { name });

    beforeEach(() => {
        usePending.setState({ byTable: {}, errors: {} });
        toast.error.mockReset();
    });

    it('stages NULL for a nullable integer', () => {
        setupClear();
        fireEvent.change(field('created_by'), { target: { value: '' } });
        fireEvent.blur(field('created_by'));
        expect(pending()[ref]).toMatchObject({
            kind: 'update',
            values: { created_by: null },
        });
    });

    it('keeps an emptied NOT NULL integer unstaged with the error tied to the field', () => {
        setupClear();
        const qty = field('qty');
        fireEvent.change(qty, { target: { value: '' } });
        fireEvent.keyDown(qty, { key: 'Enter' });
        expect(pending()).toEqual({});
        expect(qty).toHaveValue('');
        expect(qty).toHaveAttribute('aria-invalid', 'true');
        const error = screen.getByRole('alert');
        expect(error).toHaveTextContent(
            "This column can't be empty: enter a value or revert",
        );
        expect(qty.getAttribute('aria-describedby')).toContain(error.id);
    });

    it('says an emptied NOT NULL field was not staged when the drawer leaves the row', () => {
        const { unmount } = setupClear();
        fireEvent.change(field('qty'), { target: { value: '' } });
        unmount();
        expect(pending()).toEqual({});
        expect(toast.error).toHaveBeenCalledWith(
            "qty: This column can't be empty: enter a value or revert",
        );
    });

    it('stages an empty string for a varchar', () => {
        setupClear();
        fireEvent.change(field('label'), { target: { value: '' } });
        fireEvent.blur(field('label'));
        expect(pending()[ref]).toMatchObject({ values: { label: '' } });
    });
});
