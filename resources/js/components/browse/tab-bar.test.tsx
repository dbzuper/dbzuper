import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tableTabId, useBrowse } from '@/browse/browse-store';
import { TabBar } from './tab-bar';

const actions = {
    open: vi.fn(),
    structure: vi.fn(),
    openInSql: vi.fn(),
    showInUniverse: vi.fn(),
};
const st = () => useBrowse.getState();

beforeEach(() => {
    useBrowse.setState({ byConnection: {} });
    st().openTable(1, 'users', { mode: 'permanent' });
    st().openTable(1, 'orders');
});

describe('TabBar', () => {
    it('renders Universe first, marks the preview tab and selects the active one', () => {
        render(<TabBar connectionId={1} actions={actions} />);
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((t) => t.textContent)).toEqual([
            'Universe',
            'users',
            'orders',
        ]);
        expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
        expect(tabs[2]).toHaveAttribute('data-preview', 'true');
        expect(
            screen.queryByRole('button', { name: 'Close Universe' }),
        ).not.toBeInTheDocument();
    });

    it('activates on click, promotes on double-click, closes on middle-click and ×', () => {
        render(<TabBar connectionId={1} actions={actions} />);
        fireEvent.click(screen.getByRole('tab', { name: /users/ }));
        expect(st().get(1).activeId).toBe(tableTabId('users'));
        fireEvent.doubleClick(screen.getByRole('tab', { name: /orders/ }));
        const orders = st().get(1).tabs[2];
        expect(orders.kind === 'table' && orders.preview).toBe(false);
        fireEvent(
            screen.getByRole('tab', { name: /orders/ }),
            new MouseEvent('auxclick', { bubbles: true, button: 1 }),
        );
        expect(
            st()
                .get(1)
                .tabs.map((t) => t.id),
        ).toEqual(['universe', tableTabId('users')]);
        fireEvent.click(screen.getByRole('button', { name: 'Close users' }));
        expect(
            st()
                .get(1)
                .tabs.map((t) => t.id),
        ).toEqual(['universe']);
    });

    it('supports arrow-key focus movement and Delete to close', () => {
        render(<TabBar connectionId={1} actions={actions} />);
        const active = screen.getByRole('tab', { selected: true });
        active.focus();
        fireEvent.keyDown(active, { key: 'ArrowLeft' });
        expect(document.activeElement).toBe(
            screen.getByRole('tab', { name: /users/ }),
        );
        fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
        expect(
            st()
                .get(1)
                .tabs.map((t) => t.id),
        ).toEqual(['universe', tableTabId('orders')]);
    });
});
