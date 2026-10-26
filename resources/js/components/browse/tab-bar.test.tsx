import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowse } from '@/browse/browse-store';
import { tableTabOf } from '@/test/browse-tabs';
import { TabBar } from './tab-bar';

const actions = {
    open: vi.fn(),
    structure: vi.fn(),
    openInSql: vi.fn(),
    showInUniverse: vi.fn(),
};
const st = () => useBrowse.getState();
const tableTabId = (table: string) => tableTabOf('1', table)?.id;

beforeEach(() => {
    useBrowse.setState({ byConnection: {} });
    st().openTable('1', 'users', { mode: 'permanent' });
    st().openTable('1', 'orders');
});

describe('TabBar', () => {
    it('renders Universe first, marks the preview tab and selects the active one', () => {
        render(<TabBar connectionId="1" actions={actions} />);
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((t) => t.textContent)).toEqual([
            'Universe',
            'users',
            'orders',
        ]);
        expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
        expect(tabs[2]).toHaveAttribute('data-preview', 'true');
        expect(screen.queryByTitle('Close Universe')).not.toBeInTheDocument();
    });

    it('activates on click, promotes on double-click, closes on middle-click and ×', () => {
        render(<TabBar connectionId="1" actions={actions} />);
        fireEvent.click(screen.getByRole('tab', { name: /users/ }));
        expect(st().get('1').activeId).toBe(tableTabId('users'));
        fireEvent.doubleClick(screen.getByRole('tab', { name: /orders/ }));
        const orders = st().get('1').tabs[2];
        expect(orders.kind === 'table' && orders.preview).toBe(false);
        fireEvent(
            screen.getByRole('tab', { name: /orders/ }),
            new MouseEvent('auxclick', { bubbles: true, button: 1 }),
        );
        expect(
            st()
                .get('1')
                .tabs.map((t) => t.id),
        ).toEqual(['universe', tableTabId('users')]);
        fireEvent.click(screen.getByTitle('Close users'));
        expect(
            st()
                .get('1')
                .tabs.map((t) => t.id),
        ).toEqual(['universe']);
    });

    it('supports arrow-key focus movement and Delete to close', () => {
        render(<TabBar connectionId="1" actions={actions} />);
        const active = screen.getByRole('tab', { selected: true });
        active.focus();
        fireEvent.keyDown(active, { key: 'ArrowLeft' });
        expect(document.activeElement).toBe(
            screen.getByRole('tab', { name: /users/ }),
        );
        fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
        expect(
            st()
                .get('1')
                .tabs.map((t) => t.id),
        ).toEqual(['universe', tableTabId('orders')]);
    });

    it('duplicates a table tab from its context menu, filters and all', () => {
        const filters = [
            { column: 'status', op: 'eq' as const, value: 'paid' },
        ];
        st().updateTable('1', tableTabId('orders')!, { filters });
        render(<TabBar connectionId="1" actions={actions} />);
        fireEvent.contextMenu(screen.getByRole('tab', { name: 'orders' }));
        fireEvent.click(
            screen.getByRole('menuitem', { name: 'Duplicate tab' }),
        );
        expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
            'Universe',
            'users',
            'orders',
            'orders (2)',
        ]);
        expect(screen.getByRole('tab', { name: 'orders (2)' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        expect(tableTabOf('1', 'orders', 2)).toMatchObject({
            preview: false,
            state: { filters },
        });
        expect(screen.getByTitle('Close orders (2)')).toBeInTheDocument();
    });

    it('offers no Duplicate tab on the Universe tab', () => {
        render(<TabBar connectionId="1" actions={actions} />);
        fireEvent.contextMenu(screen.getByRole('tab', { name: 'Universe' }));
        expect(
            screen.getByRole('menuitem', { name: 'Close all' }),
        ).toBeVisible();
        expect(
            screen.queryByRole('menuitem', { name: 'Duplicate tab' }),
        ).toBeNull();
    });

    it("shows a tab's filters as its tooltip", () => {
        st().updateTable('1', tableTabId('orders')!, {
            filters: [
                { column: 'status', op: 'eq', value: 'paid' },
                { column: 'total', op: 'gt', value: '100' },
            ],
        });
        render(<TabBar connectionId="1" actions={actions} />);
        expect(screen.getByRole('tab', { name: 'orders' })).toHaveAttribute(
            'title',
            'status = paid · total > 100',
        );
        expect(screen.getByRole('tab', { name: 'users' })).not.toHaveAttribute(
            'title',
        );
    });

    it('keeps focus in the tab bar after closing the focused tab', () => {
        render(<TabBar connectionId="1" actions={actions} />);
        const active = screen.getByRole('tab', { selected: true });
        active.focus();
        fireEvent.keyDown(active, { key: 'Delete' });
        const now = document.activeElement as HTMLElement;
        expect(now).toHaveAttribute('role', 'tab');
        expect(now).toHaveAttribute('aria-selected', 'true');
        expect(now).toHaveTextContent('users');
    });
});
