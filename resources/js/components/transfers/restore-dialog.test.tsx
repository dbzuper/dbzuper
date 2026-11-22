import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadError, uploadInChunks } from '@/lib/chunked-upload';
import { readHead } from '@/lib/dump-sniff';
import { ApiError } from '@/lib/http';
import { transfersApi } from '@/lib/transfers-api';
import type { Transfer, TransferCapabilities } from '@/lib/transfers-api';
import type { ConnectionSummary } from '@/types/connection';
import { RestoreDialog } from './restore-dialog';

vi.mock('@/lib/chunked-upload', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/chunked-upload')>()),
    uploadInChunks: vi.fn(),
}));
vi.mock('@/lib/dump-sniff', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/dump-sniff')>()),
    readHead: vi.fn(),
}));

const upload = vi.mocked(uploadInChunks);
const head = vi.mocked(readHead);

const mysql = {
    id: 5,
    ref: '5',
    name: 'Shop',
    driver: 'mysql',
    driver_label: 'MySQL',
    database: 'shop',
    read_only: false,
} as ConnectionSummary;

const pgsql = {
    ...mysql,
    driver: 'pgsql',
    driver_label: 'PostgreSQL',
} as ConnectionSummary;

const caps = (
    over: Partial<TransferCapabilities['import']> = {},
): TransferCapabilities => ({
    read_only: false,
    database_name: 'shop',
    worker_alive: true,
    export: {
        native: {
            usable: false,
            tool: null,
            path: null,
            version: null,
            reason: '',
        },
        default_method: 'builtin',
        builtin_gaps: [],
        native_gaps: [],
    },
    import: {
        native: {
            usable: true,
            tool: 'mysql',
            path: '/usr/bin/mysql',
            version: '8.4.3',
            reason: 'mysql 8.4.3',
        },
        default_method: 'native',
        all_or_nothing: false,
        ...over,
    },
});

const started = {
    id: 't1',
    status: 'uploading',
    direction: 'import',
    bytes_done: 0,
    bytes_total: 12,
    warnings: [],
    worker_alive: true,
} as unknown as Transfer;

const MYSQL_HEAD = '-- MySQL dump 10.13  Distrib 8.4.3\n';
const PG_HEAD = '--\n-- PostgreSQL database dump\n--\n';

function mockApi(c: TransferCapabilities = caps()) {
    vi.spyOn(transfersApi, 'capabilities').mockResolvedValue(c);
    vi.spyOn(transfersApi, 'list').mockResolvedValue({ transfers: [] });
    vi.spyOn(transfersApi, 'show').mockResolvedValue(started);
    vi.spyOn(transfersApi, 'cancel').mockResolvedValue({
        ...started,
        status: 'cancelled',
    });
}

function open(
    connection: ConnectionSummary = mysql,
    onOpenChange: (o: boolean) => void = () => {},
) {
    return render(
        <RestoreDialog
            connection={connection}
            open
            onOpenChange={onOpenChange}
            serverVersion="8.4.3"
        />,
    );
}

const dumpFile = (name = 'shop-20261122.sql') =>
    new File(['SELECT 1;\n'.padEnd(12, ' ')], name, {
        type: 'application/sql',
    });

const restoreButton = () => screen.getByRole('button', { name: 'Restore' });

async function chooseFile(file: File = dumpFile()) {
    fireEvent.change(await screen.findByLabelText('File'), {
        target: { files: [file] },
    });
    await screen.findByText(file.name);
}

async function confirmWith(text: string) {
    fireEvent.change(await screen.findByLabelText('Type shop to confirm'), {
        target: { value: text },
    });
}

/** Picks a file, types the name and presses Restore. */
async function startRestore() {
    await chooseFile();
    await confirmWith('shop');
    await waitFor(() => expect(restoreButton()).toBeEnabled());
    fireEvent.click(restoreButton());
}

beforeEach(() => {
    mockApi();
    head.mockResolvedValue(MYSQL_HEAD);
    upload.mockReset();
    upload.mockReturnValue(new Promise(() => {}));
});
afterEach(() => vi.restoreAllMocks());

describe('RestoreDialog', () => {
    it('titles itself with the database and engine', async () => {
        open();
        expect(
            await screen.findByRole('heading', {
                name: 'Restore into shop (MySQL 8.4.3)',
            }),
        ).toBeInTheDocument();
    });

    it('accepts SQL and gzip files and shows the chosen name and size', async () => {
        open();
        const input = await screen.findByLabelText('File');
        expect(input).toHaveAttribute('accept', '.sql,.gz,.sql.gz');
        await chooseFile();
        expect(screen.getByText('12 B', { exact: false })).toBeInTheDocument();
    });

    it('shows the method line', async () => {
        open();
        expect(
            await screen.findByText('Native — mysql 8.4.3'),
        ).toBeInTheDocument();
    });

    it('enables Restore only when the typed name matches exactly', async () => {
        open();
        await chooseFile();
        expect(restoreButton()).toBeDisabled();
        await confirmWith('Shop');
        expect(restoreButton()).toBeDisabled();
        await confirmWith('shop ');
        expect(restoreButton()).toBeDisabled();
        await confirmWith('shop');
        await waitFor(() => expect(restoreButton()).toBeEnabled());
    });

    it('needs a file as well as the typed name', async () => {
        open();
        await confirmWith('shop');
        expect(restoreButton()).toBeDisabled();
    });

    it('warns about a pg_dump file on a MySQL connection without blocking', async () => {
        head.mockResolvedValue(PG_HEAD);
        open();
        await chooseFile();
        expect(
            await screen.findByText(
                'This file looks like a PostgreSQL dump; this database is MySQL.',
            ),
        ).toBeInTheDocument();
        await confirmWith('shop');
        await waitFor(() => expect(restoreButton()).toBeEnabled());
    });

    it('does not warn when the file matches the engine', async () => {
        open();
        await chooseFile();
        await waitFor(() => expect(head).toHaveBeenCalled());
        expect(screen.queryByText(/This file looks like/)).toBeNull();
    });

    it('warns that every statement runs against the database', async () => {
        open();
        expect(
            await screen.findByText(
                'This runs every statement in the file against shop. Existing tables may be dropped or overwritten.',
            ),
        ).toBeInTheDocument();
    });

    it('says a failed MySQL restore stays partly applied', async () => {
        open();
        expect(
            await screen.findByText(
                'If a statement fails, the statements before it stay applied.',
            ),
        ).toBeInTheDocument();
        expect(screen.queryByText(/nothing is changed/)).toBeNull();
    });

    it('says a failed PostgreSQL restore changes nothing', async () => {
        mockApi(caps({ all_or_nothing: true }));
        open(pgsql);
        expect(
            await screen.findByText(
                'If a statement fails, nothing is changed. The database stays locked until the restore finishes.',
            ),
        ).toBeInTheDocument();
        expect(screen.queryByText(/stay applied/)).toBeNull();
    });

    it('never renders for a read-only connection and closes itself', async () => {
        const onOpenChange = vi.fn();
        open({ ...mysql, read_only: true }, onOpenChange);
        await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(transfersApi.capabilities).not.toHaveBeenCalled();
    });
});

describe('RestoreDialog restore flow', () => {
    it('starts the restore, then uploads the file to it', async () => {
        const start = vi
            .spyOn(transfersApi, 'startImport')
            .mockResolvedValue(started);
        open();
        await startRestore();
        await waitFor(() =>
            expect(start).toHaveBeenCalledWith('5', {
                file_name: 'shop-20261122.sql',
                size: 12,
                confirm: 'shop',
                method: null,
            }),
        );
        await waitFor(() =>
            expect(upload).toHaveBeenCalledWith(
                expect.any(File),
                transfersApi.uploadUrl('5', 't1'),
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            ),
        );
        const region = await screen.findByRole('region', {
            name: 'Restore progress',
        });
        await waitFor(() => expect(region).toHaveFocus());
        expect(
            screen.getByText('Closing stops the upload.'),
        ).toBeInTheDocument();
    });

    it('shows the upload percentage while uploading', async () => {
        vi.spyOn(transfersApi, 'startImport').mockResolvedValue(started);
        upload.mockImplementation((_f, _u, opts) => {
            opts.onProgress(6);
            return new Promise(() => {});
        });
        open();
        await startRestore();
        const bar = await screen.findByRole('progressbar', {
            name: 'Upload progress',
        });
        await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '50'));
        expect(screen.getByText(/50%/)).toBeInTheDocument();
    });

    it('sends the chosen method', async () => {
        const start = vi
            .spyOn(transfersApi, 'startImport')
            .mockResolvedValue(started);
        open();
        fireEvent.click(
            await screen.findByRole('button', { name: 'Change method' }),
        );
        fireEvent.click(screen.getByLabelText('Built-in'));
        await startRestore();
        await waitFor(() =>
            expect(start).toHaveBeenCalledWith(
                '5',
                expect.objectContaining({ method: 'builtin' }),
            ),
        );
    });

    it('aborts the upload and cancels the restore on Cancel', async () => {
        vi.spyOn(transfersApi, 'startImport').mockResolvedValue(started);
        open();
        await startRestore();
        await waitFor(() => expect(upload).toHaveBeenCalled());
        const signal = upload.mock.calls[0][2].signal!;
        fireEvent.click(
            await screen.findByRole('button', { name: 'Cancel restore' }),
        );
        expect(signal.aborted).toBe(true);
        await waitFor(() =>
            expect(transfersApi.cancel).toHaveBeenCalledWith('5', 't1'),
        );
    });

    it('aborts the upload and cancels the restore when closed', async () => {
        vi.spyOn(transfersApi, 'startImport').mockResolvedValue(started);
        const onOpenChange = vi.fn();
        open(mysql, onOpenChange);
        await startRestore();
        await waitFor(() => expect(upload).toHaveBeenCalled());
        const signal = upload.mock.calls[0][2].signal!;
        // The footer's Close (the corner X closes the same way).
        fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(signal.aborted).toBe(true);
        expect(transfersApi.cancel).toHaveBeenCalledWith('5', 't1');
    });

    it('cancels a restore that starts after the dialog was closed', async () => {
        let resolve: (t: Transfer) => void = () => {};
        vi.spyOn(transfersApi, 'startImport').mockReturnValue(
            new Promise<Transfer>((r) => (resolve = r)),
        );
        const props = { connection: mysql, onOpenChange: () => {} };
        const { rerender } = render(<RestoreDialog {...props} open />);
        await startRestore();
        rerender(<RestoreDialog {...props} open={false} />);
        resolve(started);
        await waitFor(() =>
            expect(transfersApi.cancel).toHaveBeenCalledWith('5', 't1'),
        );
        expect(upload).not.toHaveBeenCalled();
    });

    it('leaves a finished upload alone when closed', async () => {
        vi.spyOn(transfersApi, 'startImport').mockResolvedValue(started);
        upload.mockResolvedValue(undefined);
        open();
        await startRestore();
        await waitFor(() => expect(upload).toHaveBeenCalled());
        await screen.findByRole('region', { name: 'Restore progress' });
        await waitFor(() =>
            expect(screen.queryByText('Closing stops the upload.')).toBeNull(),
        );
        // The footer's Close (the corner X closes the same way).
        expect(
            screen.getByText('The file is uploaded; the restore starts next.'),
        ).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
        expect(transfersApi.cancel).not.toHaveBeenCalled();
    });

    it('shows why the upload failed and cancels the restore', async () => {
        vi.spyOn(transfersApi, 'startImport').mockResolvedValue(started);
        upload.mockRejectedValue(
            new Error('The file is larger than the size given.'),
        );
        open();
        await startRestore();
        expect(
            await screen.findByText(/The file is larger than the size given\./),
        ).toBeInTheDocument();
        await waitFor(() =>
            expect(transfersApi.cancel).toHaveBeenCalledWith('5', 't1'),
        );
    });

    it("shows the server's message when the restore can't start", async () => {
        vi.spyOn(transfersApi, 'startImport').mockRejectedValue(
            new ApiError(409, {
                message: 'Another backup or restore is running.\nWait for it.',
            }),
        );
        open();
        await startRestore();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
            'Another backup or restore is running.',
        );
        expect(alert).toHaveClass('whitespace-pre-wrap');
    });

    it("preserves the server's multi-line failure", async () => {
        vi.spyOn(transfersApi, 'startImport').mockResolvedValue(started);
        upload.mockResolvedValue(undefined);
        vi.spyOn(transfersApi, 'show').mockResolvedValue({
            ...started,
            status: 'failed',
            error: 'Statement 3 failed:\nINSERT INTO t VALUES (1)\nDuplicate entry',
        });
        open();
        await startRestore();
        const message = await screen.findByText(/Statement 3 failed:/);
        expect(message).toHaveClass('whitespace-pre-wrap');
    });

    it('moves focus back to the file picker after New restore', async () => {
        vi.spyOn(transfersApi, 'startImport').mockResolvedValue(started);
        upload.mockResolvedValue(undefined);
        vi.spyOn(transfersApi, 'show').mockResolvedValue({
            ...started,
            status: 'done',
            statements_done: 4,
        });
        open();
        await startRestore();
        fireEvent.click(
            await screen.findByRole('button', { name: 'New restore' }),
        );
        await waitFor(() =>
            expect(screen.getByLabelText('File')).toHaveFocus(),
        );
        expect(screen.getByLabelText('Type shop to confirm')).toHaveValue('');
        expect(restoreButton()).toBeDisabled();
    });

    it('lists only restores', async () => {
        vi.spyOn(transfersApi, 'list').mockResolvedValue({
            transfers: [
                {
                    ...started,
                    id: 'b',
                    direction: 'export',
                    status: 'done',
                    downloadable: true,
                    file_name: 'shop-backup.sql.gz',
                    file_size: 10,
                } as Transfer,
                {
                    ...started,
                    id: 'r',
                    status: 'done',
                    downloadable: false,
                    file_name: 'restored-file.sql',
                    file_size: 10,
                } as Transfer,
            ],
        });
        open();
        await screen.findByText('restored-file.sql');
        expect(screen.queryByText('shop-backup.sql.gz')).toBeNull();
    });

    it('keeps the closing note after Cancel until the poll shows the end', async () => {
        vi.spyOn(transfersApi, 'startImport').mockResolvedValue(started);
        vi.spyOn(transfersApi, 'cancel').mockReturnValue(new Promise(() => {}));
        open();
        await startRestore();
        fireEvent.click(
            await screen.findByRole('button', { name: 'Cancel restore' }),
        );
        expect(
            screen.getByText('Closing stops the upload.'),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Cancel restore' }),
        ).toHaveTextContent('Cancelling…');
    });

    it('leaves a transfer that ended on the server to the status', async () => {
        vi.spyOn(transfersApi, 'startImport').mockResolvedValue(started);
        let reject: (e: unknown) => void = () => {};
        upload.mockReturnValue(new Promise((_r, j) => (reject = j)));
        open();
        await startRestore();
        await waitFor(() => expect(upload).toHaveBeenCalled());
        reject(
            new UploadError(
                'This upload is no longer accepting data.',
                409,
                'cancelled',
            ),
        );
        await waitFor(() =>
            expect(screen.queryByText('Closing stops the upload.')).toBeNull(),
        );
        expect(screen.queryByText('The upload failed.')).toBeNull();
        expect(transfersApi.cancel).not.toHaveBeenCalled();
    });

    it('clears the upload failure when another restore is shown', async () => {
        vi.spyOn(transfersApi, 'startImport').mockResolvedValue(started);
        upload.mockRejectedValue(new Error('Disk full.'));
        vi.spyOn(transfersApi, 'list').mockResolvedValue({
            transfers: [
                {
                    ...started,
                    id: 'r2',
                    status: 'running',
                    file_name: 'other.sql',
                    file_size: 10,
                } as Transfer,
            ],
        });
        open();
        await startRestore();
        await screen.findByText('The upload failed.');
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'Show the progress of other.sql',
            }),
        );
        expect(screen.queryByText('The upload failed.')).toBeNull();
    });
});

describe('RestoreDialog leaving and reopening', () => {
    it('cancels the upload with a keepalive request when the page goes away', async () => {
        vi.spyOn(transfersApi, 'startImport').mockResolvedValue(started);
        const leave = vi
            .spyOn(transfersApi, 'cancelOnLeave')
            .mockResolvedValue(undefined);
        open();
        await startRestore();
        await waitFor(() => expect(upload).toHaveBeenCalled());
        const signal = upload.mock.calls[0][2].signal!;

        window.dispatchEvent(new Event('pagehide'));

        expect(leave).toHaveBeenCalledWith('5', 't1');
        expect(signal.aborted).toBe(true);
        // Already cancelled: unmounting doesn't send a second one.
        cleanup();
        expect(transfersApi.cancel).not.toHaveBeenCalled();
        expect(leave).toHaveBeenCalledTimes(1);
    });

    it('sends nothing on pagehide without an upload in progress', async () => {
        const leave = vi
            .spyOn(transfersApi, 'cancelOnLeave')
            .mockResolvedValue(undefined);
        open();
        await screen.findByLabelText('File');
        window.dispatchEvent(new Event('pagehide'));
        expect(leave).not.toHaveBeenCalled();
    });

    it('clears the typed name and the file when closed with nothing started', async () => {
        const props = { connection: mysql, onOpenChange: () => {} };
        const { rerender } = render(<RestoreDialog {...props} open />);
        await chooseFile();
        await confirmWith('shop');
        rerender(<RestoreDialog {...props} open={false} />);
        rerender(<RestoreDialog {...props} open />);
        expect(
            await screen.findByLabelText('Type shop to confirm'),
        ).toHaveValue('');
        expect(screen.queryByText('shop-20261122.sql')).toBeNull();
        expect(restoreButton()).toBeDisabled();
    });
});
