import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transfersApi } from '@/lib/transfers-api';
import type { Transfer, TransferCapabilities } from '@/lib/transfers-api';
import {
    NO_WORKER_MESSAGE,
    TransferStatus,
    WAITING_MESSAGE,
} from './transfer-status';

const transfer = (over: Partial<Transfer> = {}): Transfer => ({
    id: 't1',
    database: 'shop',
    direction: 'export',
    method: 'builtin',
    status: 'pending',
    bytes_done: 0,
    bytes_total: null,
    rows_done: null,
    rows_total: null,
    statements_done: null,
    current_table: null,
    file_name: null,
    file_size: null,
    warnings: [],
    error: null,
    downloadable: false,
    cancel_requested_at: null,
    started_at: null,
    finished_at: null,
    expires_at: null,
    created_at: null,
    updated_at: null,
    ...over,
});

const caps = (alive: boolean) =>
    ({ worker_alive: alive }) as TransferCapabilities;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const flush = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('TransferStatus while pending', () => {
    it('shows the no-worker message only after 10 s without a heartbeat', async () => {
        vi.spyOn(transfersApi, 'show').mockResolvedValue(transfer());
        const capabilities = vi
            .spyOn(transfersApi, 'capabilities')
            .mockResolvedValue(caps(false));
        render(<TransferStatus workspace="5" transfer={transfer()} />);

        await flush();
        expect(screen.getByText(WAITING_MESSAGE)).toBeInTheDocument();
        await flush(9000);
        expect(screen.queryByText(NO_WORKER_MESSAGE)).toBeNull();
        await flush(1500);
        expect(screen.getByText(NO_WORKER_MESSAGE)).toBeInTheDocument();
        expect(screen.queryByText(WAITING_MESSAGE)).toBeNull();
        // Re-checked every 5 s while pending.
        expect(capabilities.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('keeps the waiting message while a worker is alive', async () => {
        vi.spyOn(transfersApi, 'show').mockResolvedValue(transfer());
        vi.spyOn(transfersApi, 'capabilities').mockResolvedValue(caps(true));
        render(<TransferStatus workspace="5" transfer={transfer()} />);
        await flush(15000);
        expect(screen.getByText(WAITING_MESSAGE)).toBeInTheDocument();
        expect(screen.queryByText(NO_WORKER_MESSAGE)).toBeNull();
    });

    it('stops checking the worker once the job runs', async () => {
        vi.spyOn(transfersApi, 'show').mockResolvedValue(
            transfer({ status: 'running' }),
        );
        const capabilities = vi
            .spyOn(transfersApi, 'capabilities')
            .mockResolvedValue(caps(false));
        render(<TransferStatus workspace="5" transfer={transfer()} />);
        // Let React apply the first poll before the clock runs on.
        await flush();
        await flush(20000);
        expect(screen.queryByText(NO_WORKER_MESSAGE)).toBeNull();
        expect(capabilities.mock.calls.length).toBeLessThanOrEqual(1);
    });
});

describe('TransferStatus progress and results', () => {
    it('shows the current table and rows, and cancels', async () => {
        const running = transfer({
            status: 'running',
            current_table: 'orders',
            rows_done: 1200,
            rows_total: 5000,
        });
        vi.spyOn(transfersApi, 'show').mockResolvedValue(running);
        const cancel = vi
            .spyOn(transfersApi, 'cancel')
            .mockResolvedValue(running);
        render(<TransferStatus workspace="5" transfer={running} />);
        await flush();
        expect(screen.getByText('orders')).toBeInTheDocument();
        expect(screen.getByText('1,200 of 5,000 rows')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toHaveAttribute(
            'aria-valuenow',
            '24',
        );
        await act(async () => {
            screen.getByRole('button', { name: 'Cancel backup' }).click();
        });
        expect(cancel).toHaveBeenCalledWith('5', 't1');
    });

    it('falls back to bytes when rows are unknown', async () => {
        const running = transfer({ status: 'running', bytes_done: 2048 });
        vi.spyOn(transfersApi, 'show').mockResolvedValue(running);
        render(<TransferStatus workspace="5" transfer={running} />);
        await flush();
        expect(screen.getByText('2 KB written')).toBeInTheDocument();
    });

    it('offers the download as a plain link, with warnings, and reports done once', async () => {
        const done = transfer({
            status: 'done',
            downloadable: true,
            file_name: 'shop-20261123-101500.sql.gz',
            file_size: 4096,
            warnings: ['Skipped routines: no privilege'],
        });
        vi.spyOn(transfersApi, 'show').mockResolvedValue(done);
        const onDone = vi.fn();
        render(
            <TransferStatus workspace="5" transfer={done} onDone={onDone} />,
        );
        await flush(3000);
        const link = screen.getByRole('link', { name: /Download/ });
        expect(link).toHaveAttribute('href', '/api/c/5/transfers/t1/download');
        expect(link).toHaveAttribute('download');
        expect(
            screen.getByText('Skipped routines: no privilege'),
        ).toBeInTheDocument();
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('shows a failure with its line breaks kept', async () => {
        const failed = transfer({
            status: 'failed',
            error: 'mysqldump failed\nAccess denied',
        });
        vi.spyOn(transfersApi, 'show').mockResolvedValue(failed);
        render(<TransferStatus workspace="5" transfer={failed} />);
        await flush();
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('mysqldump failed\nAccess denied');
        expect(alert.querySelector('.whitespace-pre-wrap')).not.toBeNull();
    });

    it('shows a poll error', async () => {
        vi.spyOn(transfersApi, 'show').mockRejectedValue(new TypeError('x'));
        vi.spyOn(transfersApi, 'capabilities').mockResolvedValue(caps(true));
        render(<TransferStatus workspace="5" transfer={transfer()} />);
        await flush(3000);
        expect(screen.getByRole('alert')).toHaveTextContent(
            "Couldn't reach the server",
        );
    });
});
