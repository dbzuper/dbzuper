import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushBrowse, useBrowse, type TableTab } from '@/browse/browse-store';
import { usePending } from '@/editing/pending-store';
import { PendingGuard } from './pending-guard';

const C = '1';
const st = () => useBrowse.getState();
const tableTabs = () =>
    st()
        .get(C)
        .tabs.filter((t): t is TableTab => t.kind === 'table');

beforeEach(() => {
    flushBrowse();
    useBrowse.setState({ byConnection: {} });
    usePending.setState({ byTable: {}, errors: {} });
});
afterEach(() => vi.restoreAllMocks());

const stage = (table = 'orders', n = 2) => {
    for (let i = 0; i < n; i++) usePending.getState().addRow(C, table);
};

describe('PendingGuard', () => {
    it('asks before closing the last view of a table with pending changes', () => {
        render(<PendingGuard />);
        st().openTable(C, 'orders', { mode: 'permanent' });
        stage();
        act(() => st().closeTab(C, tableTabs()[0].id));
        const dialog = screen.getByRole('dialog', {
            name: 'Discard 2 pending changes to `orders`?',
        });
        expect(tableTabs()).toHaveLength(1);
        fireEvent.click(
            within(dialog).getByRole('button', { name: 'Keep changes' }),
        );
        expect(tableTabs()).toHaveLength(1);
        expect(usePending.getState().count(C, 'orders').inserted).toBe(2);

        act(() => st().closeTab(C, tableTabs()[0].id));
        fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', {
                name: 'Discard',
            }),
        );
        expect(tableTabs()).toHaveLength(0);
        expect(usePending.getState().byTable).toEqual({});
    });

    it('closes a view without asking while another view of the table stays open', () => {
        render(<PendingGuard />);
        st().openTable(C, 'orders', { mode: 'permanent' });
        st().openNewView(C, 'orders');
        stage();
        act(() => st().closeTab(C, tableTabs()[1].id));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(tableTabs()).toHaveLength(1);
        expect(usePending.getState().count(C, 'orders').inserted).toBe(2);
    });

    it('closes the last view of a table without pending changes at once', () => {
        render(<PendingGuard />);
        st().openTable(C, 'orders', { mode: 'permanent' });
        stage('users');
        act(() => st().closeAll(C));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(tableTabs()).toHaveLength(0);
    });

    it('asks once for every table that close all would leave without a view', () => {
        render(<PendingGuard />);
        st().openTable(C, 'orders', { mode: 'permanent' });
        st().openTable(C, 'users', { mode: 'permanent' });
        st().openTable(C, 'items', { mode: 'permanent' });
        stage('orders', 1);
        stage('users', 2);
        act(() => st().closeAll(C));
        expect(
            screen.getByRole('dialog', {
                name: 'Discard 3 pending changes to `orders`, `users`?',
            }),
        ).toBeInTheDocument();
    });

    it('keeps the changes of a table that still has a view once the held close goes ahead', () => {
        render(<PendingGuard />);
        st().openTable(C, 'orders');
        stage();
        act(() => {
            st().openTable(C, 'users');
        });
        // Meanwhile the preview was kept: the replacement is dropped and nothing is discarded.
        st().promote(C, tableTabs()[0].id);
        fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', {
                name: 'Discard',
            }),
        );
        expect(tableTabs().map((t) => t.table)).toEqual(['orders']);
        expect(usePending.getState().count(C, 'orders').inserted).toBe(2);
    });

    it('registers the leave-page prompt only while changes are pending', () => {
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');
        const registered = () =>
            add.mock.calls.filter(([type]) => type === 'beforeunload').length;
        render(<PendingGuard />);
        expect(registered()).toBe(0);
        act(() => stage());
        expect(registered()).toBe(1);
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        act(() => usePending.getState().discard(C, 'orders'));
        expect(
            remove.mock.calls.filter(([type]) => type === 'beforeunload'),
        ).toHaveLength(1);
        const later = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(later);
        expect(later.defaultPrevented).toBe(false);
    });
});
