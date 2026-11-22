import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transfersApi } from '@/lib/transfers-api';
import type {
    DumpObject,
    Transfer,
    TransferCapabilities,
} from '@/lib/transfers-api';
import type { ConnectionSummary } from '@/types/connection';
import { BackupDialog } from './backup-dialog';

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
    over: Partial<TransferCapabilities['export']> = {},
): TransferCapabilities => ({
    read_only: false,
    database_name: 'shop',
    worker_alive: true,
    export: {
        native: {
            usable: false,
            tool: 'mysqldump',
            path: null,
            version: null,
            reason: 'mysqldump not found — using built-in',
        },
        default_method: 'builtin',
        builtin_gaps: ['stored procedures and functions', 'events'],
        native_gaps: [],
        ...over,
    },
    import: {
        native: {
            usable: false,
            tool: null,
            path: null,
            version: null,
            reason: '',
        },
        default_method: 'builtin',
        all_or_nothing: false,
    },
});

const nativeUsable = {
    native: {
        usable: true,
        tool: 'mysqldump',
        path: '/usr/bin/mysqldump',
        version: '8.4.3',
        reason: 'mysqldump 8.4.3',
    },
    default_method: 'native' as const,
    native_gaps: [],
};

const obj = (name: string, schema: string | null = null): DumpObject => ({
    schema,
    name,
    kind: 'table',
    key: schema === null ? name : JSON.stringify([schema, name]),
    rows: 10,
});

const started = {
    id: 't1',
    status: 'pending',
    direction: 'export',
    warnings: [],
} as unknown as Transfer;

let capabilities: ReturnType<typeof vi.fn>;

function mockApi(
    c: TransferCapabilities = caps(),
    objects: DumpObject[] = [obj('orders'), obj('users')],
) {
    capabilities = vi.fn().mockResolvedValue(c);
    vi.spyOn(transfersApi, 'capabilities').mockImplementation(
        capabilities as never,
    );
    vi.spyOn(transfersApi, 'objects').mockResolvedValue({ objects });
    vi.spyOn(transfersApi, 'list').mockResolvedValue({ transfers: [] });
    vi.spyOn(transfersApi, 'show').mockResolvedValue(started);
}

function open(connection: ConnectionSummary = mysql) {
    return render(
        <BackupDialog
            connection={connection}
            open
            onOpenChange={() => {}}
            serverVersion="8.4.3"
        />,
    );
}

const backUp = () => screen.getByRole('button', { name: 'Back up' });

beforeEach(() => mockApi());
afterEach(() => vi.restoreAllMocks());

describe('BackupDialog', () => {
    it('titles itself with the database and engine', async () => {
        open();
        expect(
            await screen.findByRole('heading', {
                name: 'Back up shop (MySQL 8.4.3)',
            }),
        ).toBeInTheDocument();
        expect(await screen.findByLabelText('All 2')).toBeChecked();
    });

    it('disables Back up when neither structure nor data is included', async () => {
        open();
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(screen.getByRole('checkbox', { name: 'Structure' }));
        expect(backUp()).toBeEnabled();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Data' }));
        expect(backUp()).toBeDisabled();
    });

    it('only offers DROP with structure', async () => {
        open();
        const drop = await screen.findByRole('checkbox', {
            name: 'Add DROP … IF EXISTS before each CREATE',
        });
        expect(drop).toBeChecked();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Structure' }));
        expect(
            screen.queryByRole('checkbox', {
                name: 'Add DROP … IF EXISTS before each CREATE',
            }),
        ).toBeNull();
    });

    it('sends the defaults', async () => {
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        await waitFor(() => expect(backUp()).toBeEnabled());
        expect(
            screen.getByRole('checkbox', { name: 'Compress (.sql.gz)' }),
        ).toBeChecked();
        fireEvent.click(backUp());
        await waitFor(() =>
            expect(start).toHaveBeenCalledWith('5', {
                tables: 'all',
                structure: true,
                data: true,
                drop: true,
                gzip: true,
                method: null,
            }),
        );
        expect(
            await screen.findByRole('button', { name: 'Cancel backup' }),
        ).toBeInTheDocument();
    });

    it('lists what built-in leaves out on MySQL', async () => {
        open();
        expect(
            await screen.findByText(
                'Not included: stored procedures and functions, events.',
            ),
        ).toBeInTheDocument();
        expect(
            screen.getByText('mysqldump not found — using built-in'),
        ).toBeInTheDocument();
    });

    it('shows the native method and lets the user switch to built-in', async () => {
        mockApi(caps(nativeUsable));
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        expect(
            await screen.findByText('Native — mysqldump 8.4.3'),
        ).toBeInTheDocument();
        expect(
            screen.getByText('Includes everything in the chosen tables.'),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Change method' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Built-in' }));
        expect(screen.getByText(/^Not included: stored/)).toBeInTheDocument();
        fireEvent.click(backUp());
        await waitFor(() =>
            expect(start).toHaveBeenCalledWith(
                '5',
                expect.objectContaining({ method: 'builtin' }),
            ),
        );
    });

    it('disables native with its reason when it is unusable', async () => {
        open();
        await screen.findByText('mysqldump not found — using built-in');
        fireEvent.click(screen.getByRole('button', { name: 'Change method' }));
        expect(screen.getByRole('radio', { name: /^Native/ })).toBeDisabled();
        expect(screen.getByRole('radio', { name: 'Built-in' })).toBeChecked();
    });

    it('sends the chosen tables and re-reads the native gaps for them', async () => {
        mockApi(caps(nativeUsable));
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        fireEvent.click(await screen.findByLabelText('Choose…'));
        expect(backUp()).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox', { name: /^users/ }));
        await waitFor(() =>
            expect(capabilities).toHaveBeenCalledWith('5', ['users']),
        );
        fireEvent.click(backUp());
        await waitFor(() =>
            expect(start).toHaveBeenCalledWith(
                '5',
                expect.objectContaining({ tables: ['users'] }),
            ),
        );
    });

    it('filters the checklist by search', async () => {
        open();
        fireEvent.click(await screen.findByLabelText('Choose…'));
        fireEvent.change(
            screen.getByRole('searchbox', { name: 'Filter tables' }),
            {
                target: { value: 'ord' },
            },
        );
        expect(
            screen.getByRole('checkbox', { name: /^orders/ }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: /^users/ })).toBeNull();
    });

    it('groups the PostgreSQL picker by schema', async () => {
        mockApi(caps(), [
            obj('users', 'public'),
            obj('orders', 'sales'),
            obj('invoices', 'sales'),
        ]);
        open(pgsql);
        fireEvent.click(await screen.findByLabelText('Choose…'));
        const sales = screen.getByRole('group', { name: 'sales' });
        expect(
            within(sales).getByRole('checkbox', { name: /^orders/ }),
        ).toBeInTheDocument();
        expect(
            within(sales).getByRole('checkbox', { name: /^invoices/ }),
        ).toBeInTheDocument();
        expect(
            within(screen.getByRole('group', { name: 'public' })).getByRole(
                'checkbox',
                { name: /^users/ },
            ),
        ).toBeInTheDocument();
    });

    it('shows why a backup could not start', async () => {
        const { ApiError } = await import('@/lib/http');
        vi.spyOn(transfersApi, 'startExport').mockRejectedValue(
            new ApiError(409, {
                message: 'Another backup or restore is running.',
            }),
        );
        open();
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Another backup or restore is running.',
        );
    });

    it('lists recent downloadable backups', async () => {
        vi.spyOn(transfersApi, 'list').mockResolvedValue({
            transfers: [
                {
                    ...started,
                    id: 'old',
                    status: 'done',
                    downloadable: true,
                    file_name: 'shop-20261122-090000.sql.gz',
                    file_size: 1024,
                } as Transfer,
            ],
        });
        open();
        const link = await screen.findByRole('link', {
            name: /shop-20261122-090000\.sql\.gz/,
        });
        expect(link).toHaveAttribute('href', '/api/c/5/transfers/old/download');
    });
});
