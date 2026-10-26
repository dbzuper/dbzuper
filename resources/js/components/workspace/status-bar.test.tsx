import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowse, UNIVERSE_TAB } from '@/browse/browse-store';
import { useTabStatus, type TabStatus } from '@/browse/status-store';
import { usePending } from '@/editing/pending-store';
import { useReview } from '@/editing/review-store';
import { useRecords } from '@/records/records-store';
import { emptyTrail, type Trail } from '@/records/trail';
import type { ConnectionSummary } from '@/types/connection';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useWorkspace } from '@/universe/store';
import { StatusBar } from './status-bar';

const connection = {
    id: 1,
    ref: '1',
    name: 'shop',
    driver: 'mysql',
    driver_label: 'MySQL',
    host: '127.0.0.1',
    port: 3307,
    database: 'shop',
    read_only: false,
    color: null,
} as ConnectionSummary;

const snapshot = makeSnapshot(
    [{ name: 'orders' }, { name: 'users' }, { name: 'items' }],
    [
        { from_table: 'orders', to_table: 'users' },
        { from_table: 'items', to_table: 'orders', inferred: true },
    ],
);

const renderBar = () =>
    render(
        <StatusBar
            connection={connection}
            snapshot={snapshot}
            storedAt="2026-10-15T11:55:00Z"
        />,
    );

/** Opens `orders` as the active tab and returns its id. */
const openOrders = (status?: TabStatus) => {
    const id = useBrowse
        .getState()
        .openTable('1', 'orders', { mode: 'permanent' });
    if (status) useTabStatus.getState().publish(id, status);
    return id;
};

beforeEach(() => {
    useBrowse.setState({ byConnection: {} });
    useTabStatus.setState({ byTab: {} });
    usePending.setState({ byTable: {}, errors: {} });
    useWorkspace.getState().reset();
    useRecords.setState({ trail: emptyTrail() });
});
afterEach(() => vi.restoreAllMocks());

describe('StatusBar', () => {
    it('is a labelled footer, not a live region', () => {
        renderBar();
        const bar = screen.getByRole('contentinfo', { name: 'Status bar' });
        expect(bar).not.toHaveAttribute('aria-live');
        expect(bar).toHaveTextContent('MySQL');
        expect(bar).toHaveTextContent('127.0.0.1:3307/shop');
    });

    it('shows the row range, the total and the round-trip time', () => {
        openOrders({
            from: 101,
            to: 200,
            total: { count: 1234, exact: true },
            ms: 38,
        });
        renderBar();
        expect(screen.getByText('Rows 101–200 of 1,234')).toBeInTheDocument();
        expect(screen.getByText('38 ms')).toBeInTheDocument();
    });

    it('marks an estimate and a lower bound', () => {
        const id = openOrders({
            from: 1,
            to: 50,
            total: { count: 1234, exact: false },
            ms: 5,
        });
        const { unmount } = renderBar();
        expect(screen.getByText('Rows 1–50 of ~1,234')).toBeInTheDocument();
        unmount();
        useTabStatus
            .getState()
            .publish(id, { from: 1, to: 50, total: { atLeast: 1234 }, ms: 5 });
        renderBar();
        expect(screen.getByText('Rows 1–50 of 1,234+')).toBeInTheDocument();
    });

    it('leaves "of" out without a total, and says No rows for an empty result', () => {
        const id = openOrders({ from: 1, to: 50, total: null, ms: 5 });
        const { unmount } = renderBar();
        expect(screen.getByText('Rows 1–50')).toBeInTheDocument();
        unmount();
        useTabStatus
            .getState()
            .publish(id, { from: 0, to: 0, total: null, ms: 5 });
        renderBar();
        expect(screen.getByText('No rows')).toBeInTheDocument();
    });

    it('shows no rows text for a table tab that has published nothing', () => {
        openOrders();
        renderBar();
        expect(screen.queryByText(/Rows|No rows/)).toBeNull();
        expect(screen.queryByText(/ ms$/)).toBeNull();
    });

    it('offers the pending changes, which open the review', () => {
        openOrders({
            from: 1,
            to: 1,
            total: { count: 1, exact: true },
            ms: 1,
        });
        renderBar();
        expect(screen.queryByRole('button', { name: /pending/ })).toBeNull();
        const spy = vi.spyOn(useReview.getState(), 'openReview');
        act(() =>
            usePending.getState().setCell(
                '1',
                'orders',
                {
                    ref: '{"id":1}',
                    id: { id: 1 } as never,
                    original: { name: 'a' },
                },
                'name',
                'b',
            ),
        );
        const button = screen.getByRole('button', {
            name: '1 pending change',
        });
        fireEvent.click(button);
        expect(spy).toHaveBeenCalledWith('1', 'orders');
    });

    it('counts tables and relations on the universe, inferred ones only while shown', () => {
        useBrowse.setState({
            byConnection: {
                1: {
                    tabs: [UNIVERSE_TAB],
                    activeId: 'universe',
                    recents: [],
                    perPage: 50,
                },
            },
        });
        renderBar();
        expect(screen.getByText('3 tables · 2 relations')).toBeInTheDocument();
        act(() => useWorkspace.setState({ showInferred: false }));
        expect(screen.getByText('3 tables · 1 relation')).toBeInTheDocument();
    });

    it('counts the records on the trail', () => {
        useBrowse.setState({
            byConnection: {
                1: {
                    tabs: [
                        UNIVERSE_TAB,
                        { id: 'records', kind: 'records', title: 'Records' },
                    ],
                    activeId: 'records',
                    recents: [],
                    perPage: 50,
                },
            },
        });
        useRecords.setState({
            trail: {
                nodes: [{ id: 'a' }, { id: 'b' }],
                edges: [],
                selected: null,
            } as unknown as Trail,
        });
        renderBar();
        expect(screen.getByText('2 records')).toBeInTheDocument();
    });

    it('shows the snapshot age', () => {
        renderBar();
        expect(screen.getByText(/^Snapshot /)).toBeInTheDocument();
    });

    it('toggles the SQL dock', () => {
        renderBar();
        const dock = screen.getByRole('button', { name: /^SQL/ });
        expect(dock).toHaveTextContent('SQL Ctrl J');
        expect(dock).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(dock);
        expect(useWorkspace.getState().dockOpen).toBe(true);
        expect(dock).toHaveAttribute('aria-pressed', 'true');
    });
});

describe('StatusBar overflow', () => {
    it('clips instead of spilling and lets the row range truncate first', () => {
        openOrders({
            from: 1,
            to: 50,
            total: { count: 1234, exact: true },
            ms: 38,
        });
        renderBar();
        expect(screen.getByRole('contentinfo')).toHaveClass('overflow-hidden');
        const range = screen.getByText('Rows 1–50 of 1,234');
        expect(range).toHaveClass('min-w-0', 'truncate');
    });
});
