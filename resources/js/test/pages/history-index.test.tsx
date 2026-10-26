import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const visit = vi.hoisted(() => vi.fn());
vi.mock('@inertiajs/react', () => ({
    Head: () => null,
    router: { visit },
}));
vi.mock('@/layouts/app-layout', () => ({
    default: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
}));
const historyApi = vi.hoisted(() => ({ list: vi.fn(), clear: vi.fn() }));
vi.mock('@/lib/history-api', () => ({ historyApi }));

import HistoryIndex from '@/pages/history/index';

const entry = (over: object = {}) => ({
    id: 5,
    sql: 'select 1',
    kind: 'read',
    status: 'ok',
    duration_ms: 1,
    row_count: 1,
    affected: null,
    error: null,
    created_at: new Date().toISOString(),
    connection: { id: 3, name: 'Shop' },
    database: null,
    ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('history page', () => {
    it('opens an entry by id, never by SQL', async () => {
        historyApi.list.mockResolvedValue({
            entries: [entry()],
            next_before_id: null,
        });
        render(<HistoryIndex connections={[{ id: 3, name: 'Shop' }]} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
        expect(visit).toHaveBeenCalledWith(
            '/c/3?history=5',
            expect.objectContaining({ onError: expect.any(Function) }),
        );
    });

    it('opens an entry in the database it ran on', async () => {
        historyApi.list.mockResolvedValue({
            entries: [entry({ database: 'shop staging' })],
            next_before_id: null,
        });
        render(<HistoryIndex connections={[{ id: 3, name: 'Shop' }]} />);
        expect(
            await screen.findByText('Shop · shop staging'),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Open' }));
        expect(visit).toHaveBeenCalledWith(
            '/c/3/shop%20staging?history=5',
            expect.objectContaining({ onError: expect.any(Function) }),
        );
    });

    it('shows a message when the visit fails', async () => {
        historyApi.list.mockResolvedValue({
            entries: [entry()],
            next_before_id: null,
        });
        visit.mockImplementation((_u, opts) => opts.onError({}));
        render(<HistoryIndex connections={[]} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent(
                /could not open/i,
            ),
        );
    });

    it('shows a message when the entry has no connection', async () => {
        historyApi.list.mockResolvedValue({
            entries: [entry({ connection: undefined })],
            next_before_id: null,
        });
        render(<HistoryIndex connections={[]} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            /could not open/i,
        );
        expect(visit).not.toHaveBeenCalled();
    });
});
