import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryList } from '@/components/history/history-list';
import type { HistoryEntry } from '@/lib/history-api';
import { useWorkspace } from '@/universe/store';

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
    id: 1,
    sql: 'select 1\nfrom dual',
    kind: 'read',
    status: 'ok',
    duration_ms: 12,
    row_count: 3,
    affected: null,
    error: null,
    created_at: new Date().toISOString(),
    ...over,
});

const json = (body: unknown) =>
    Promise.resolve(
        new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }),
    );

let fetchMock: ReturnType<typeof vi.fn>;
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

async function flush() {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(() =>
        json({
            entries: [
                entry(),
                entry({
                    id: 2,
                    status: 'error',
                    error: 'boom',
                    row_count: null,
                }),
            ],
            next_before_id: null,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('HistoryList', () => {
    it('renders entries with status, first-line preview, duration and rows', async () => {
        render(<HistoryList connectionId="7" onOpen={vi.fn()} />);
        await flush();
        expect(urls()[0]).toBe('/api/c/7/history');
        expect(screen.getByLabelText('Succeeded')).toBeInTheDocument();
        expect(screen.getByLabelText('Failed')).toBeInTheDocument();
        expect(screen.getAllByText('select 1').length).toBe(2);
        expect(screen.getAllByText(/12 ms/).length).toBe(2);
        expect(screen.getByText(/3 rows/)).toBeInTheDocument();
        expect(screen.getAllByText(/just now/).length).toBe(2);
    });

    it('debounces search by 250 ms', async () => {
        render(<HistoryList connectionId="7" onOpen={vi.fn()} />);
        await flush();
        fireEvent.change(screen.getByLabelText('Search history'), {
            target: { value: 'ord' },
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(200);
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(60);
        });
        expect(urls()[1]).toBe('/api/c/7/history?q=ord');
    });

    it('filters by status', async () => {
        render(<HistoryList connectionId="7" onOpen={vi.fn()} />);
        await flush();
        fireEvent.change(screen.getByLabelText('Status'), {
            target: { value: 'error' },
        });
        await flush();
        expect(urls()[1]).toBe('/api/c/7/history?status=error');
    });

    it('shows Load more only with next_before_id and fetches with before_id', async () => {
        fetchMock.mockImplementationOnce(() =>
            json({ entries: [entry({ id: 9 })], next_before_id: 9 }),
        );
        render(<HistoryList connectionId="7" onOpen={vi.fn()} />);
        await flush();
        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        await flush();
        expect(urls()[1]).toBe('/api/c/7/history?before_id=9');
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Open' }).length).toBe(3);
    });

    it('calls onOpen with the entry', async () => {
        const onOpen = vi.fn();
        render(<HistoryList connectionId="7" onOpen={onOpen} />);
        await flush();
        fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    });

    it('offers a connection filter on the global list and names each row', async () => {
        fetchMock.mockImplementationOnce(() =>
            json({
                entries: [entry({ connection: { id: 2, name: 'Shop' } })],
                next_before_id: null,
            }),
        );
        render(
            <HistoryList
                connectionId={null}
                connections={[
                    { id: 1, name: 'Blog' },
                    { id: 2, name: 'Shop' },
                ]}
                onOpen={vi.fn()}
            />,
        );
        await flush();
        expect(urls()[0]).toBe('/api/history');
        expect(
            screen.getByText('Shop', { selector: 'span' }),
        ).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Connection'), {
            target: { value: '2' },
        });
        await flush();
        expect(urls()[1]).toBe('/api/history?connection_id=2');
        expect(
            screen.queryByRole('button', { name: 'Clear history' }),
        ).toBeNull();
    });

    it('clears history only after an inline confirmation', async () => {
        render(<HistoryList connectionId="7" onOpen={vi.fn()} />);
        await flush();
        fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
        expect(
            fetchMock.mock.calls.some((c) => c[1]?.method === 'DELETE'),
        ).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Confirm clear' }));
        await flush();
        const del = fetchMock.mock.calls.find((c) => c[1]?.method === 'DELETE');
        expect(String(del?.[0])).toBe('/api/c/7/history');
    });

    it('clears a load-more error when retrying', async () => {
        fetchMock.mockImplementationOnce(() =>
            json({ entries: [entry({ id: 9 })], next_before_id: 9 }),
        );
        render(<HistoryList connectionId="7" onOpen={vi.fn()} />);
        await flush();
        fetchMock.mockImplementationOnce(() => Promise.reject(new Error('x')));
        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        await flush();
        expect(screen.getByRole('alert')).toBeInTheDocument();
        fetchMock.mockImplementationOnce(() =>
            json({ entries: [], next_before_id: null }),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        expect(screen.queryByRole('alert')).toBeNull();
        await flush();
    });

    it('disables Confirm clear while the DELETE is in flight', async () => {
        render(<HistoryList connectionId="7" onOpen={vi.fn()} />);
        await flush();
        fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
        fetchMock.mockImplementationOnce(() => new Promise(() => {}));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm clear' }));
        await flush();
        expect(
            screen.getByRole('button', { name: 'Confirm clear' }),
        ).toBeDisabled();
    });

    it('reloads after a run finishes in workspace mode, but not on the global page', async () => {
        const { unmount } = render(
            <HistoryList connectionId="7" onOpen={vi.fn()} />,
        );
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        act(() => useWorkspace.getState().bumpRuns());
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        unmount();

        render(<HistoryList connectionId={null} onOpen={vi.fn()} />);
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(3);
        act(() => useWorkspace.getState().bumpRuns());
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});
