import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowse } from '@/browse/browse-store';
import {
    readGroupPrefs,
    writeGroupingEnabled,
    writeGroupPrefs,
} from '@/browse/local-prefs';
import { usePins } from '@/browse/pins-store';
import type { SchemaSnapshot } from '@/types/schema';
import { tableTabOf } from '@/test/browse-tabs';
import { TableSidebar } from './table-sidebar';

vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: ({ count }: { count: number }) => ({
        getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
                index,
                key: index,
                start: index * 28,
                size: 28,
            })),
        getTotalSize: () => count * 28,
        scrollToIndex: vi.fn(),
    }),
}));
vi.mock('@/lib/pins-api', () => ({
    pinsApi: {
        list: vi.fn().mockResolvedValue({ pins: [] }),
        add: vi.fn().mockResolvedValue({
            pin: { id: 3, table: 'orders', position: 1 },
        }),
        remove: vi.fn(),
        reorder: vi.fn(),
    },
}));

const table = (name: string, kind: 'table' | 'view' = 'table') => ({
    name,
    kind,
    row_count: { count: 1200, kind: 'estimate' as const },
    size_bytes: null,
    primary_key: ['id'],
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
    ],
    indexes: [],
});
const snapshot = {
    driver: 'mysql',
    database: 'd',
    schema: null,
    generated_at: '',
    hash: '',
    relationships: [],
    tables: [
        table('users'),
        table('orders'),
        table('order items'),
        table('active_users', 'view'),
    ],
} as SchemaSnapshot;

const actions = {
    open: vi.fn(),
    structure: vi.fn(),
    openInSql: vi.fn(),
    showInUniverse: vi.fn(),
};

const renderSidebar = () =>
    render(
        <TableSidebar connectionId={1} snapshot={snapshot} actions={actions} />,
    );

/** Moves focus as Tab would: to the next element in the tab order after `from`. */
const tabFrom = (from: HTMLElement) => {
    const stops = [
        ...document.querySelectorAll<HTMLElement>('input, button, [tabindex]'),
    ].filter((el) => el.tabIndex >= 0);
    stops[stops.indexOf(from) + 1]?.focus();
};

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useBrowse.setState({ byConnection: {} });
    usePins.setState({ byConnection: {} });
});

describe('TableSidebar', () => {
    it('lists all tables with counts and marks views', () => {
        renderSidebar();
        const tree = screen.getByRole('tree', { name: 'Tables' });
        // Four table rows under the section's own header treeitem.
        expect(
            within(tree)
                .getAllByRole('treeitem')
                .filter((r) => r.hasAttribute('data-table')),
        ).toHaveLength(4);
        expect(
            within(tree).getByRole('treeitem', { name: 'All tables (4)' }),
        ).toHaveAttribute('aria-expanded', 'true');
        // The name holds the visible text: the table and its row count.
        expect(
            screen.getByRole('treeitem', { name: 'users, ~1.2K rows' }),
        ).toBeInTheDocument();
        expect(
            within(
                screen.getByRole('treeitem', { name: /active_users/ }),
            ).getByLabelText('View'),
        ).toBeInTheDocument();
        expect(
            within(screen.getByRole('treeitem', { name: /^users/ })).getByText(
                '~1.2K',
            ),
        ).toBeInTheDocument();
    });

    it('opens a preview on click, a permanent tab on double-click and Ctrl+click, a background tab on middle-click', () => {
        renderSidebar();
        const row = screen.getByRole('treeitem', { name: /^orders/ });
        fireEvent.click(row);
        fireEvent.doubleClick(row);
        fireEvent.click(row, { ctrlKey: true });
        fireEvent(
            row,
            new MouseEvent('auxclick', { bubbles: true, button: 1 }),
        );
        expect(actions.open.mock.calls).toEqual([
            ['orders', 'preview'],
            ['orders', 'permanent'],
            ['orders', 'permanent'],
            ['orders', 'background'],
        ]);
    });

    it('opens a new default view from Open in new tab when the table is already open', () => {
        const filters = [{ column: 'id', op: 'eq' as const, value: '1' }];
        const first = useBrowse
            .getState()
            .openTable(1, 'orders', { mode: 'permanent', state: { filters } });
        renderSidebar();
        fireEvent.contextMenu(
            screen.getAllByRole('treeitem', { name: /^orders/ })[0],
        );
        fireEvent.click(
            screen.getByRole('menuitem', { name: 'Open in new tab' }),
        );
        const view = tableTabOf(1, 'orders', 2);
        expect(view).toMatchObject({
            preview: false,
            state: { filters: [], page: 1 },
        });
        expect(useBrowse.getState().get(1).activeId).toBe(view?.id);
        expect(tableTabOf(1, 'orders')?.id).toBe(first);
        expect(tableTabOf(1, 'orders')?.state.filters).toEqual(filters);
    });

    it('opens a background tab from Open in new tab when the table is not open', () => {
        renderSidebar();
        fireEvent.contextMenu(screen.getByRole('treeitem', { name: /^users/ }));
        fireEvent.click(
            screen.getByRole('menuitem', { name: 'Open in new tab' }),
        );
        expect(tableTabOf(1, 'users')).toMatchObject({ preview: false });
        expect(useBrowse.getState().get(1).activeId).toBe('universe');
    });

    it('keeps the recent rows still under the pointer, so a double-click lands on one table', () => {
        useBrowse.getState().openTable(1, 'users');
        renderSidebar();
        const tree = screen.getByRole('tree', { name: 'Tables' });
        const recentNames = () =>
            within(screen.getByRole('group', { name: 'Recent' }))
                .getAllByRole('treeitem')
                .flatMap((el) => el.getAttribute('data-table') ?? []);
        fireEvent.pointerEnter(tree);
        // Opening tables while the pointer is in the tree neither reorders nor grows Recent.
        act(() => {
            useBrowse.getState().openTable(1, 'orders');
            useBrowse.getState().openTable(1, 'order items');
        });
        expect(recentNames()).toEqual(['users']);
        fireEvent.pointerLeave(tree);
        expect(recentNames()).toEqual(['order items', 'orders', 'users']);
    });

    it('filters by search and hides the pinned and recent sections while searching', () => {
        useBrowse.getState().openTable(1, 'users');
        renderSidebar();
        expect(
            screen.getByRole('treeitem', { name: 'Recent' }),
        ).toBeInTheDocument();
        fireEvent.change(
            screen.getByRole('searchbox', { name: 'Search tables' }),
            { target: { value: 'order' } },
        );
        expect(
            screen.queryByRole('treeitem', { name: 'Recent' }),
        ).not.toBeInTheDocument();
        expect(
            screen
                .getAllByRole('treeitem')
                .flatMap((r) => r.getAttribute('data-table') ?? []),
        ).toEqual(['orders', 'order items']);
    });

    it('moves focus with the arrow keys and opens with Enter', () => {
        renderSidebar();
        const rows = screen.getAllByRole('treeitem');
        rows[0].focus();
        fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
        expect(document.activeElement).toBe(rows[1]);
        fireEvent.keyDown(rows[1], { key: 'Enter' });
        expect(actions.open).toHaveBeenCalledWith(
            rows[1].getAttribute('data-table'),
            'permanent',
        );
    });

    it('collapses and expands a section from its header treeitem by click and keyboard', () => {
        renderSidebar();
        const header = screen.getByRole('treeitem', { name: 'All tables (4)' });
        // The first header is the tree's tab stop.
        expect(header).toHaveAttribute('tabindex', '0');
        fireEvent.click(header);
        expect(header).toHaveAttribute('aria-expanded', 'false');
        expect(
            screen.queryByRole('treeitem', { name: /^orders/ }),
        ).not.toBeInTheDocument();
        header.focus();
        fireEvent.keyDown(header, { key: 'ArrowRight' });
        expect(header).toHaveAttribute('aria-expanded', 'true');
        fireEvent.keyDown(header, { key: 'ArrowLeft' });
        expect(header).toHaveAttribute('aria-expanded', 'false');
        fireEvent.keyDown(header, { key: 'Enter' });
        expect(header).toHaveAttribute('aria-expanded', 'true');
        expect(actions.open).not.toHaveBeenCalled();
    });

    it('moves from the search box to the first table, past its section header', () => {
        renderSidebar();
        fireEvent.keyDown(
            screen.getByRole('searchbox', { name: 'Search tables' }),
            { key: 'ArrowDown' },
        );
        expect(document.activeElement).toHaveAttribute('data-table', 'users');
    });

    it('pins from the row star without opening the table', () => {
        renderSidebar();
        fireEvent.click(screen.getByRole('button', { name: 'Pin orders' }));
        expect(usePins.getState().isPinned(1, 'orders')).toBe(true);
        expect(actions.open).not.toHaveBeenCalled();
    });

    it('leaves pinned tables out of Recent and shows at most five recent tables', () => {
        const names = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
        const many = { ...snapshot, tables: names.map((n) => table(n)) };
        names.forEach((n) => useBrowse.getState().openTable(1, n));
        usePins.setState({
            byConnection: { 1: [{ id: 1, table: 't6', position: 1 }] },
        });
        render(
            <TableSidebar connectionId={1} snapshot={many} actions={actions} />,
        );
        const recent = within(screen.getByRole('group', { name: 'Recent' }))
            .getAllByRole('treeitem')
            .flatMap((el) => el.getAttribute('data-table') ?? []);
        expect(recent).toEqual(['t7', 't5', 't4', 't3', 't2']);
    });

    it('shows pinned tables first and a missing pin as removable', () => {
        usePins.setState({
            byConnection: {
                1: [
                    { id: 1, table: 'orders', position: 1 },
                    { id: 2, table: 'gone', position: 2 },
                ],
            },
        });
        renderSidebar();
        const pinned = screen.getByRole('group', { name: 'Pinned' });
        expect(within(pinned).getByText('orders')).toBeInTheDocument();
        expect(
            within(pinned).getByRole('button', { name: 'Remove gone' }),
        ).toBeInTheDocument();
    });

    it('reaches a missing pin with the arrow keys and removes it with Delete or *', async () => {
        usePins.setState({
            byConnection: {
                1: [
                    { id: 1, table: 'orders', position: 1 },
                    { id: 2, table: 'gone', position: 2 },
                    { id: 4, table: 'lost', position: 3 },
                ],
            },
        });
        renderSidebar();
        const orders = within(
            screen.getByRole('group', { name: 'Pinned' }),
        ).getByRole('treeitem', { name: /^orders/ });
        orders.focus();
        fireEvent.keyDown(orders, { key: 'ArrowDown' });
        const gone = screen.getByRole('treeitem', {
            name: 'gone (no longer exists)',
        });
        expect(gone).toHaveFocus();
        expect(gone).toHaveAttribute('tabindex', '0');
        fireEvent.keyDown(gone, { key: 'Enter' });
        expect(actions.open).not.toHaveBeenCalled();
        fireEvent.keyDown(gone, { key: 'Delete' });
        expect(usePins.getState().isPinned(1, 'gone')).toBe(false);
        const lost = screen.getByRole('treeitem', {
            name: 'lost (no longer exists)',
        });
        expect(lost).toHaveFocus();
        fireEvent.keyDown(lost, { key: '*' });
        // Pin operations on a connection run one after another.
        await waitFor(() =>
            expect(usePins.getState().isPinned(1, 'lost')).toBe(false),
        );
    });

    it("highlights the active tab's table", () => {
        useBrowse.getState().openTable(1, 'orders');
        renderSidebar();
        const all = screen.getByRole('group', { name: /All tables/ });
        expect(
            within(all).getByRole('treeitem', { name: /^orders/ }),
        ).toHaveAttribute('aria-current', 'true');
    });

    it('pins the focused table with the asterisk key', () => {
        renderSidebar();
        const row = screen.getByRole('treeitem', { name: /^orders/ });
        row.focus();
        fireEvent.keyDown(row, { key: '*' });
        expect(usePins.getState().isPinned(1, 'orders')).toBe(true);
    });

    it('makes the clicked row the tab stop', () => {
        renderSidebar();
        const row = screen.getByRole('treeitem', { name: /^orders/ });
        expect(row).toHaveAttribute('tabindex', '-1');
        fireEvent.click(row);
        expect(row).toHaveAttribute('tabindex', '0');
        expect(
            screen
                .getAllByRole('treeitem')
                .filter((r) => r.getAttribute('tabindex') === '0'),
        ).toHaveLength(1);
    });
});

describe('TableSidebar prefix groups', () => {
    const grouped = {
        ...snapshot,
        tables: ['courier_rates', 'courier_zones', 'orders'].map((n) =>
            table(n),
        ),
    } as SchemaSnapshot;
    const renderGrouped = () =>
        render(
            <TableSidebar
                connectionId={1}
                snapshot={grouped}
                actions={actions}
            />,
        );
    const group = () =>
        screen.getByRole('treeitem', { name: 'courier_ group, 2 tables' });
    const groupRows = () =>
        screen
            .queryAllByRole('treeitem')
            .filter((r) => r.getAttribute('data-key')?.startsWith('group:'));
    const tableRows = () =>
        screen
            .getAllByRole('treeitem')
            .flatMap((r) => r.getAttribute('data-table') ?? []);

    it('shows a collapsed group row for tables sharing a prefix', () => {
        renderGrouped();
        expect(group()).toHaveAttribute('aria-expanded', 'false');
        expect(group()).toHaveAttribute('aria-level', '2');
        expect(group()).toHaveAttribute('data-key', 'group:courier_');
        expect(within(group()).getByText('2')).toHaveClass(
            'font-mono',
            'text-[11px]',
            'text-muted-foreground',
        );
        expect(
            screen.queryByRole('treeitem', { name: /^courier_rates/ }),
        ).not.toBeInTheDocument();
        expect(tableRows()).toEqual(['orders']);
    });

    it('expands a group with Enter and keeps it open across a remount', () => {
        const first = renderGrouped();
        group().focus();
        fireEvent.keyDown(group(), { key: 'Enter' });
        expect(group()).toHaveAttribute('aria-expanded', 'true');
        expect(tableRows()).toEqual([
            'courier_rates',
            'courier_zones',
            'orders',
        ]);
        const child = screen.getByRole('treeitem', { name: /^courier_rates/ });
        expect(child).toHaveAttribute('aria-level', '3');
        // The prefix is muted; the accessible name keeps the full table name.
        expect(within(child).getByText('courier_')).toHaveClass(
            'text-muted-foreground',
        );
        expect(actions.open).not.toHaveBeenCalled();
        first.unmount();
        renderGrouped();
        expect(group()).toHaveAttribute('aria-expanded', 'true');
        expect(
            screen.getByRole('treeitem', { name: /^courier_zones/ }),
        ).toBeInTheDocument();
    });

    it('opens, enters, leaves and closes a group with the arrow keys', () => {
        renderGrouped();
        group().focus();
        fireEvent.keyDown(group(), { key: 'ArrowRight' });
        expect(group()).toHaveAttribute('aria-expanded', 'true');
        expect(document.activeElement).toBe(group());
        fireEvent.keyDown(group(), { key: 'ArrowRight' });
        expect(document.activeElement).toHaveAttribute(
            'data-table',
            'courier_rates',
        );
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
        expect(document.activeElement).toBe(group());
        fireEvent.keyDown(group(), { key: 'ArrowLeft' });
        expect(group()).toHaveAttribute('aria-expanded', 'false');
        fireEvent.keyDown(group(), { key: ' ' });
        expect(group()).toHaveAttribute('aria-expanded', 'true');
    });

    it("opens the active table's group without remembering it", () => {
        renderGrouped();
        expect(group()).toHaveAttribute('aria-expanded', 'false');
        act(() => {
            useBrowse.getState().openTable(1, 'courier_zones');
        });
        expect(group()).toHaveAttribute('aria-expanded', 'true');
        const all = screen.getByRole('group', { name: /All tables/ });
        expect(
            within(all).getByRole('treeitem', { name: /^courier_zones/ }),
        ).toHaveAttribute('aria-current', 'true');
        expect(readGroupPrefs(1).open).toEqual([]);
    });

    it("starts another connection from its own groups, not the previous connection's", () => {
        const two = {
            ...snapshot,
            tables: ['courier_rates', 'courier_zones', 'ship_a', 'ship_b'].map(
                (n) => table(n),
            ),
        } as SchemaSnapshot;
        writeGroupPrefs(1, { open: ['courier_'] });
        useBrowse.getState().openTable(2, 'ship_a');
        const view = render(
            <TableSidebar connectionId={1} snapshot={two} actions={actions} />,
        );
        expect(group()).toHaveAttribute('aria-expanded', 'true');
        view.rerender(
            <TableSidebar connectionId={2} snapshot={two} actions={actions} />,
        );
        expect(group()).toHaveAttribute('aria-expanded', 'false');
        expect(
            screen.getByRole('treeitem', { name: 'ship_ group, 2 tables' }),
        ).toHaveAttribute('aria-expanded', 'true');
        expect(readGroupPrefs(2).open).toEqual([]);
    });

    it('opens the active table group on mount', () => {
        useBrowse.getState().openTable(1, 'courier_zones');
        renderGrouped();
        expect(group()).toHaveAttribute('aria-expanded', 'true');
    });

    it('shows a flat list while searching', () => {
        renderGrouped();
        fireEvent.change(
            screen.getByRole('searchbox', { name: 'Search tables' }),
            { target: { value: 'cour' } },
        );
        expect(groupRows()).toHaveLength(0);
        expect(tableRows()).toEqual(['courier_rates', 'courier_zones']);
        expect(
            screen.queryByRole('button', { name: 'Group by prefix' }),
        ).not.toBeInTheDocument();
    });

    it('turns grouping off from the All tables header and remembers it', () => {
        const first = renderGrouped();
        const toggle = screen.getByRole('button', { name: 'Group by prefix' });
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        expect(toggle).not.toHaveAttribute('role', 'treeitem');
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        // The click is the toggle's alone: the section stays open.
        expect(
            screen.getByRole('treeitem', { name: 'All tables (3)' }),
        ).toHaveAttribute('aria-expanded', 'true');
        expect(groupRows()).toHaveLength(0);
        expect(tableRows()).toEqual([
            'courier_rates',
            'courier_zones',
            'orders',
        ]);
        first.unmount();
        renderGrouped();
        expect(
            screen.getByRole('button', { name: 'Group by prefix' }),
        ).toHaveAttribute('aria-pressed', 'false');
        expect(groupRows()).toHaveLength(0);
    });

    it('keeps a tab stop on the group when the tabbable table is hidden in it', () => {
        writeGroupingEnabled(false);
        renderGrouped();
        fireEvent.click(
            screen.getByRole('treeitem', { name: /^courier_rates/ }),
        );
        // Turning grouping on hides the tab stop's table inside the closed group.
        const toggle = screen.getByRole('button', { name: 'Group by prefix' });
        fireEvent.click(toggle);
        expect(group()).toHaveAttribute('aria-expanded', 'false');
        tabFrom(toggle);
        expect(document.activeElement).toHaveAttribute(
            'data-key',
            'group:courier_',
        );
    });
});

describe('TableSidebar type-ahead and levels', () => {
    const grouped = {
        ...snapshot,
        tables: ['courier_rates', 'courier_zones', 'orders'].map((n) =>
            table(n),
        ),
    } as SchemaSnapshot;
    const renderGrouped = () =>
        render(
            <TableSidebar
                connectionId={1}
                snapshot={grouped}
                actions={actions}
            />,
        );

    it('type-aheads from a focused group row to the next matching table', () => {
        renderGrouped();
        const group = screen.getByRole('treeitem', {
            name: 'courier_ group, 2 tables',
        });
        group.focus();
        fireEvent.keyDown(group, { key: 'o' });
        expect(document.activeElement).toHaveAttribute('data-table', 'orders');
    });

    it('gives loose rows in All tables the same level as group rows', () => {
        renderGrouped();
        expect(
            screen.getByRole('treeitem', { name: /^orders/ }),
        ).toHaveAttribute('aria-level', '2');
    });
});
