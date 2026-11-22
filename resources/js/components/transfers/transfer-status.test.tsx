import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transfersApi } from '@/lib/transfers-api';
import type { Transfer } from '@/lib/transfers-api';
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
    worker_alive: true,
    ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const flush = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('TransferStatus while pending', () => {
    const NOW = new Date('2026-11-23T10:00:00Z');
    const pending = (alive: boolean, createdSecondsAgo = 0) =>
        transfer({
            worker_alive: alive,
            created_at: new Date(
                NOW.getTime() - createdSecondsAgo * 1000,
            ).toISOString(),
        });

    beforeEach(() => vi.setSystemTime(NOW));

    it('shows the no-worker message only after 10 s without a heartbeat', async () => {
        vi.spyOn(transfersApi, 'show').mockResolvedValue(pending(false));
        const capabilities = vi.spyOn(transfersApi, 'capabilities');
        render(<TransferStatus workspace="5" transfer={pending(false)} />);

        await flush();
        expect(screen.getByText(WAITING_MESSAGE)).toBeInTheDocument();
        await flush(9000);
        expect(screen.queryByText(NO_WORKER_MESSAGE)).toBeNull();
        await flush(1500);
        expect(screen.getByText(NO_WORKER_MESSAGE)).toBeInTheDocument();
        expect(screen.queryByText(WAITING_MESSAGE)).toBeNull();
        // The heartbeat comes with each poll: nothing else is fetched.
        expect(capabilities).not.toHaveBeenCalled();
    });

    it('counts the wait from the transfer creation, not from opening the dialog', async () => {
        vi.spyOn(transfersApi, 'show').mockResolvedValue(pending(false, 30));
        render(<TransferStatus workspace="5" transfer={pending(false, 30)} />);
        await flush();
        expect(screen.getByText(NO_WORKER_MESSAGE)).toBeInTheDocument();
    });

    it('keeps the waiting message while a worker is alive', async () => {
        vi.spyOn(transfersApi, 'show').mockResolvedValue(pending(true));
        render(<TransferStatus workspace="5" transfer={pending(true)} />);
        await flush(15000);
        expect(screen.getByText(WAITING_MESSAGE)).toBeInTheDocument();
        expect(screen.queryByText(NO_WORKER_MESSAGE)).toBeNull();
    });

    it('switches to the no-worker message when the heartbeat stops', async () => {
        vi.spyOn(transfersApi, 'show')
            .mockResolvedValueOnce(pending(true, 20))
            .mockResolvedValue(pending(false, 20));
        render(<TransferStatus workspace="5" transfer={pending(true, 20)} />);
        await flush();
        expect(screen.getByText(WAITING_MESSAGE)).toBeInTheDocument();
        await flush(1000);
        expect(screen.getByText(NO_WORKER_MESSAGE)).toBeInTheDocument();
    });

    it('announces state changes but not every progress tick', async () => {
        const running = (rows: number) =>
            transfer({ status: 'running', rows_done: rows, rows_total: 100 });
        vi.spyOn(transfersApi, 'show')
            .mockResolvedValueOnce(running(10))
            .mockResolvedValue(running(20));
        render(<TransferStatus workspace="5" transfer={pending(true)} />);
        await flush();
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('The backup is running.');
        await flush(1000);
        expect(status).toHaveTextContent('The backup is running.');
        expect(status).not.toHaveTextContent('rows');
        expect(
            screen.getByText('20 of 100 rows').closest('[aria-live]'),
        ).toBeNull();
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
        render(<TransferStatus workspace="5" transfer={transfer()} />);
        await flush(3000);
        expect(screen.getByRole('alert')).toHaveTextContent(
            "Couldn't reach the server",
        );
    });
});

describe('TransferStatus while uploading', () => {
    const uploading = (bytes_done: number) =>
        transfer({
            direction: 'import',
            status: 'uploading',
            bytes_done,
            bytes_total: 4 * 1024 * 1024,
        });

    it('shows the upload percentage from the poll', async () => {
        vi.spyOn(transfersApi, 'show').mockResolvedValue(
            uploading(1024 * 1024),
        );
        render(<TransferStatus workspace="5" transfer={uploading(0)} />);
        await flush();
        expect(
            screen.getByRole('progressbar', { name: 'Upload progress' }),
        ).toHaveAttribute('aria-valuenow', '25');
        expect(screen.getByText('25% · 1 MB of 4 MB')).toBeInTheDocument();
        expect(
            screen.getByText(
                'Keep this dialog open until the upload finishes.',
            ),
        ).toBeInTheDocument();
    });

    it("uses the page's own count when it is ahead of the poll", async () => {
        vi.spyOn(transfersApi, 'show').mockResolvedValue(uploading(0));
        render(
            <TransferStatus
                workspace="5"
                transfer={uploading(0)}
                uploaded={2 * 1024 * 1024}
                uploadNote="Closing stops the upload."
            />,
        );
        await flush();
        expect(
            screen.getByRole('progressbar', { name: 'Upload progress' }),
        ).toHaveAttribute('aria-valuenow', '50');
        expect(
            screen.getByText('Closing stops the upload.'),
        ).toBeInTheDocument();
    });

    it('calls onCancel before cancelling on the server', async () => {
        vi.spyOn(transfersApi, 'show').mockResolvedValue(uploading(0));
        const calls: string[] = [];
        vi.spyOn(transfersApi, 'cancel').mockImplementation(() => {
            calls.push('server');
            return new Promise(() => {});
        });
        render(
            <TransferStatus
                workspace="5"
                transfer={uploading(0)}
                onCancel={() => calls.push('page')}
            />,
        );
        await flush();
        act(() =>
            screen.getByRole('button', { name: 'Cancel restore' }).click(),
        );
        expect(calls).toEqual(['page', 'server']);
    });
});

describe('TransferStatus after a cancel', () => {
    const cancelled = (over: Partial<Transfer> = {}) =>
        transfer({ status: 'cancelled', direction: 'import', ...over });

    it('says statements that ran stay applied for a started MySQL/MariaDB restore', async () => {
        const t = cancelled({ started_at: '2026-11-23T10:00:00+00:00' });
        vi.spyOn(transfersApi, 'show').mockResolvedValue(t);
        const { container } = render(
            <TransferStatus workspace="5" transfer={t} keepsApplied />,
        );
        await flush();
        expect(container).toHaveTextContent(
            'The restore was cancelled. Statements that already ran stay applied.',
        );
    });

    it('says nothing was changed for PostgreSQL/SQLite, or a restore that never started', async () => {
        const started = cancelled({ started_at: '2026-11-23T10:00:00+00:00' });
        vi.spyOn(transfersApi, 'show').mockResolvedValue(started);
        const pg = render(<TransferStatus workspace="5" transfer={started} />);
        await flush();
        expect(pg.container).toHaveTextContent(
            'The restore was cancelled. Nothing was changed.',
        );
        pg.unmount();

        const queued = cancelled();
        vi.spyOn(transfersApi, 'show').mockResolvedValue(queued);
        const mysql = render(
            <TransferStatus workspace="5" transfer={queued} keepsApplied />,
        );
        await flush();
        expect(mysql.container).toHaveTextContent(
            'The restore was cancelled. Nothing was changed.',
        );
    });

    it('adds no outcome to a cancelled backup', async () => {
        const t = transfer({ status: 'cancelled' });
        vi.spyOn(transfersApi, 'show').mockResolvedValue(t);
        const { container } = render(
            <TransferStatus workspace="5" transfer={t} keepsApplied />,
        );
        await flush();
        expect(
            container.querySelector('p.text-muted-foreground'),
        ).toHaveTextContent(/^The backup was cancelled\.$/);
    });
});
