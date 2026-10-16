import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowse } from '@/browse/browse-store';
import { usePins } from '@/browse/pins-store';
import type { SchemaSnapshot } from '@/types/schema';
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
        add: vi.fn(),
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

beforeEach(() => {
    vi.clearAllMocks();
    useBrowse.setState({ byConnection: {} });
    usePins.setState({ byConnection: {} });
});

describe('TableSidebar', () => {
    it('lists all tables with counts and marks views', () => {
        renderSidebar();
        const tree = screen.getByRole('tree', { name: 'Tables' });
        expect(within(tree).getAllByRole('treeitem')).toHaveLength(4);
        expect(screen.getByText('All tables (4)')).toBeInTheDocument();
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

    it('filters by search and hides the pinned and recent sections while searching', () => {
        useBrowse.getState().openTable(1, 'users');
        renderSidebar();
        expect(
            screen.getByRole('button', { name: /Recent/ }),
        ).toBeInTheDocument();
        fireEvent.change(
            screen.getByRole('searchbox', { name: 'Search tables' }),
            { target: { value: 'order' } },
        );
        expect(
            screen.queryByRole('button', { name: /Recent/ }),
        ).not.toBeInTheDocument();
        expect(
            screen
                .getAllByRole('treeitem')
                .map((r) => r.getAttribute('data-table')),
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

    it("highlights the active tab's table", () => {
        useBrowse.getState().openTable(1, 'orders');
        renderSidebar();
        const all = screen.getByRole('group', { name: /All tables/ });
        expect(
            within(all).getByRole('treeitem', { name: /^orders/ }),
        ).toHaveAttribute('aria-current', 'true');
    });
});
