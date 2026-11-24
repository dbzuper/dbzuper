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
            version: null,
            reason: 'mysqldump not found — using built-in',
        },
        default_method: 'builtin',
        builtin_gaps: ['stored procedures and functions', 'events'],
        native_gaps: [],
        mix_needs_builtin: false,
        ...over,
    },
    import: {
        native: {
            usable: false,
            tool: null,
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

const big = (name: string, rows: number | null): DumpObject => ({
    ...obj(name),
    rows,
});

const modeSelect = (name: string) =>
    screen.getByRole('combobox', { name: `Mode for ${name}` });

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
            expect(capabilities).toHaveBeenCalledWith(
                '5',
                ['users'],
                undefined,
            ),
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

describe('BackupDialog choices and capabilities', () => {
    it('sends drop: false without structure', async () => {
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(screen.getByRole('checkbox', { name: 'Structure' }));
        fireEvent.click(backUp());
        await waitFor(() =>
            expect(start).toHaveBeenCalledWith(
                '5',
                expect.objectContaining({
                    structure: false,
                    data: true,
                    drop: false,
                }),
            ),
        );
    });

    it('sends the explicit list even with every box ticked', async () => {
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        fireEvent.click(await screen.findByLabelText('Choose…'));
        fireEvent.click(screen.getByRole('checkbox', { name: /^orders/ }));
        fireEvent.click(screen.getByRole('checkbox', { name: /^users/ }));
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        await waitFor(() =>
            expect(start).toHaveBeenCalledWith(
                '5',
                expect.objectContaining({ tables: ['orders', 'users'] }),
            ),
        );
        expect(capabilities).toHaveBeenCalledWith(
            '5',
            ['orders', 'users'],
            undefined,
        );
    });

    it('says Checking… and holds Back up while the chosen set is re-read', async () => {
        open();
        await waitFor(() => expect(backUp()).toBeEnabled());
        let release: (c: TransferCapabilities) => void = () => {};
        capabilities.mockImplementation(
            () => new Promise<TransferCapabilities>((r) => (release = r)),
        );
        fireEvent.click(screen.getByLabelText('Choose…'));
        fireEvent.click(screen.getByRole('checkbox', { name: /^users/ }));
        expect(screen.getByText('Checking…')).toBeInTheDocument();
        expect(backUp()).toBeDisabled();
        await waitFor(() => expect(capabilities).toHaveBeenCalledTimes(2));
        release(caps());
        await waitFor(() => expect(backUp()).toBeEnabled());
        expect(screen.getByText(/^Not included:/)).toBeInTheDocument();
    });

    it('ignores a capabilities answer that arrives after a newer one', async () => {
        mockApi(caps(nativeUsable));
        open();
        await screen.findByText('Native — mysqldump 8.4.3');
        let releaseOld: (c: TransferCapabilities) => void = () => {};
        capabilities
            .mockImplementationOnce(
                () =>
                    new Promise<TransferCapabilities>((r) => (releaseOld = r)),
            )
            .mockResolvedValueOnce(
                caps({ ...nativeUsable, native_gaps: ['NEW gap'] }),
            );
        fireEvent.click(screen.getByLabelText('Choose…'));
        fireEvent.click(screen.getByRole('checkbox', { name: /^users/ }));
        await waitFor(() =>
            expect(capabilities).toHaveBeenCalledWith(
                '5',
                ['users'],
                undefined,
            ),
        );
        fireEvent.click(screen.getByRole('checkbox', { name: /^orders/ }));
        await screen.findByText('Not included: NEW gap.');
        releaseOld(caps({ ...nativeUsable, native_gaps: ['OLD gap'] }));
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.getByText('Not included: NEW gap.')).toBeInTheDocument();
        expect(screen.queryByText('Not included: OLD gap.')).toBeNull();
    });

    it('labels the clear button by what it clears', async () => {
        open();
        fireEvent.click(await screen.findByLabelText('Choose…'));
        expect(
            screen.getByRole('button', { name: 'Clear all' }),
        ).toBeDisabled();
        fireEvent.change(
            screen.getByRole('searchbox', { name: 'Filter tables' }),
            { target: { value: 'ord' } },
        );
        expect(
            screen.getByRole('button', { name: 'Clear shown' }),
        ).toBeInTheDocument();
    });
});

describe('BackupDialog focus and recent list', () => {
    it('moves focus to the progress after Back up and to the form after New backup', async () => {
        vi.spyOn(transfersApi, 'startExport').mockResolvedValue(started);
        vi.spyOn(transfersApi, 'show').mockResolvedValue({
            ...started,
            status: 'done',
            downloadable: false,
        } as Transfer);
        open();
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        const region = await screen.findByRole('region', {
            name: 'Backup progress',
        });
        await waitFor(() => expect(region).toHaveFocus());
        fireEvent.click(
            await screen.findByRole('button', { name: 'New backup' }),
        );
        await waitFor(() =>
            expect(screen.getByLabelText('All 2')).toHaveFocus(),
        );
    });

    it('lists only backups', async () => {
        vi.spyOn(transfersApi, 'list').mockResolvedValue({
            transfers: [
                {
                    ...started,
                    id: 'b',
                    status: 'done',
                    downloadable: true,
                    file_name: 'shop-backup.sql.gz',
                    file_size: 10,
                } as Transfer,
                {
                    ...started,
                    id: 'r',
                    direction: 'import',
                    status: 'done',
                    downloadable: false,
                    file_name: 'restored-file.sql',
                    file_size: 10,
                } as Transfer,
            ],
        });
        open();
        await screen.findByText('shop-backup.sql.gz');
        expect(screen.queryByText('restored-file.sql')).toBeNull();
    });
});

describe('BackupDialog object list reloads', () => {
    it('drops a chosen table that is gone when the list is read again', async () => {
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        const props = {
            connection: mysql,
            onOpenChange: () => {},
            serverVersion: '8.4.3',
        };
        const { rerender } = render(<BackupDialog {...props} open />);
        fireEvent.click(await screen.findByLabelText('Choose…'));
        fireEvent.click(screen.getByRole('checkbox', { name: /^orders/ }));
        fireEvent.click(screen.getByRole('checkbox', { name: /^users/ }));

        rerender(<BackupDialog {...props} open={false} />);
        vi.spyOn(transfersApi, 'objects').mockResolvedValue({
            objects: [obj('users')],
        });
        rerender(<BackupDialog {...props} open />);
        await screen.findByLabelText('All 1');
        expect(screen.getByText('1 of 1 chosen')).toBeInTheDocument();

        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        await waitFor(() =>
            expect(start).toHaveBeenCalledWith(
                '5',
                expect.objectContaining({ tables: ['users'] }),
            ),
        );
    });
});

describe('BackupDialog per-table modes', () => {
    const tick = async (...names: string[]) => {
        fireEvent.click(await screen.findByLabelText('Choose…'));
        for (const n of names)
            fireEvent.click(
                screen.getByRole('checkbox', { name: new RegExp(`^${n}`) }),
            );
    };

    it('gives each ticked table its own mode, defaulting to Include', async () => {
        open();
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Data' }));
        await tick('users');
        expect(modeSelect('users')).toHaveValue('structure');
        expect(
            screen.queryByRole('combobox', { name: 'Mode for orders' }),
        ).toBeNull();
        fireEvent.change(modeSelect('users'), { target: { value: 'data' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /^orders/ }));
        expect(modeSelect('orders')).toHaveValue('structure');
        expect(modeSelect('users')).toHaveValue('data');
        expect(
            screen.getAllByRole('option', { name: 'Structure + data' }).length,
        ).toBeGreaterThan(0);
    });

    it('gives views no mode', async () => {
        mockApi(caps(), [
            obj('orders'),
            obj('users'),
            { ...obj('v_totals'), kind: 'view' },
        ]);
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        await tick('orders', 'users', 'v_totals');
        expect(
            screen.queryByRole('combobox', { name: 'Mode for v_totals' }),
        ).toBeNull();
        fireEvent.change(modeSelect('users'), {
            target: { value: 'structure' },
        });
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        await waitFor(() =>
            expect(start).toHaveBeenCalledWith(
                '5',
                expect.objectContaining({
                    table_modes: { orders: 'both', users: 'structure' },
                }),
            ),
        );
    });

    it('sets every ticked table from the Include checkboxes', async () => {
        open();
        await tick('orders', 'users');
        fireEvent.change(modeSelect('orders'), { target: { value: 'data' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Data' }));
        expect(modeSelect('orders')).toHaveValue('structure');
        expect(modeSelect('users')).toHaveValue('structure');
        fireEvent.change(modeSelect('users'), { target: { value: 'both' } });
        expect(modeSelect('users')).toHaveValue('both');
        expect(modeSelect('orders')).toHaveValue('structure');
    });

    it('makes ticked tables data only when Structure is unchecked after ticking', async () => {
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        await tick('users');
        expect(modeSelect('users')).toHaveValue('both');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Structure' }));
        expect(modeSelect('users')).toHaveValue('data');
        expect(
            screen.queryByRole('checkbox', {
                name: 'Add DROP … IF EXISTS before each CREATE',
            }),
        ).toBeNull();
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
        expect(start.mock.calls[0][1]).toEqual(
            expect.objectContaining({
                tables: ['users'],
                structure: false,
                data: true,
                drop: false,
            }),
        );
        expect(start.mock.calls[0][1]).not.toHaveProperty('table_modes');
    });

    it('sends one shared mode as the global structure and data, without table_modes', async () => {
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        await tick('orders', 'users');
        fireEvent.change(modeSelect('orders'), {
            target: { value: 'structure' },
        });
        fireEvent.change(modeSelect('users'), {
            target: { value: 'structure' },
        });
        await waitFor(() => expect(backUp()).toBeEnabled());
        expect(capabilities).toHaveBeenLastCalledWith(
            '5',
            ['orders', 'users'],
            undefined,
        );
        fireEvent.click(backUp());
        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
        expect(start.mock.calls[0][1]).toEqual(
            expect.objectContaining({ structure: true, data: false }),
        );
        expect(start.mock.calls[0][1]).not.toHaveProperty('table_modes');
    });

    it('offers DROP for a ticked view only with Structure on', async () => {
        mockApi(caps(), [obj('orders'), { ...obj('v_totals'), kind: 'view' }]);
        open();
        await tick('v_totals');
        const drop = { name: 'Add DROP … IF EXISTS before each CREATE' };
        expect(screen.getByRole('checkbox', drop)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Structure' }));
        expect(screen.queryByRole('checkbox', drop)).toBeNull();
    });

    it('sends table_modes and re-reads capabilities when a mode changes', async () => {
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        await tick('orders', 'users');
        await waitFor(() =>
            expect(capabilities).toHaveBeenLastCalledWith(
                '5',
                ['orders', 'users'],
                undefined,
            ),
        );
        fireEvent.change(modeSelect('users'), { target: { value: 'data' } });
        await waitFor(() =>
            expect(capabilities).toHaveBeenLastCalledWith(
                '5',
                ['orders', 'users'],
                { orders: 'both', users: 'data' },
            ),
        );
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        await waitFor(() =>
            expect(start).toHaveBeenCalledWith(
                '5',
                expect.objectContaining({
                    structure: true,
                    data: true,
                    table_modes: { orders: 'both', users: 'data' },
                }),
            ),
        );
    });

    it('removes the mode when a table is unticked', async () => {
        open();
        await tick('orders');
        fireEvent.click(screen.getByRole('checkbox', { name: /^orders/ }));
        expect(
            screen.queryByRole('combobox', { name: 'Mode for orders' }),
        ).toBeNull();
        expect(screen.getByText('0 of 2 chosen')).toBeInTheDocument();
    });

    it('shows the data-only note and hides DROP when nothing includes structure', async () => {
        open();
        await tick('users');
        const note =
            'Data only: on restore its rows are added to an existing table; the table is not created or replaced.';
        expect(screen.queryByText(note)).toBeNull();
        fireEvent.change(modeSelect('users'), { target: { value: 'data' } });
        expect(screen.getByText(note)).toBeInTheDocument();
        const drop = { name: 'Add DROP … IF EXISTS before each CREATE' };
        expect(screen.queryByRole('checkbox', drop)).toBeNull();
        fireEvent.change(modeSelect('users'), { target: { value: 'both' } });
        expect(screen.getByRole('checkbox', drop)).toBeInTheDocument();
        expect(screen.queryByText(note)).toBeNull();
    });

    const mixCaps = () =>
        caps({
            native: {
                usable: false,
                tool: 'mysqldump',
                version: '8.4.3',
                reason: 'This mix of tables needs the built-in method',
            },
            default_method: 'builtin',
            mix_needs_builtin: true,
        });

    it('warns before a big backup the mix forces onto built-in', async () => {
        mockApi(mixCaps(), [big('orders', 1_200_000), big('users', 5)]);
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        await tick('orders', 'users');
        fireEvent.change(modeSelect('users'), {
            target: { value: 'structure' },
        });
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
            'This mix of tables needs the built-in method, which is slower than mysqldump for about 1.2 million rows.',
        );
        expect(start).not.toHaveBeenCalled();
        fireEvent.click(
            within(alert).getByRole('button', { name: 'Back up anyway' }),
        );
        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    });

    it('closes the warning on Change tables and focuses the filter', async () => {
        mockApi(mixCaps(), [big('orders', 1_200_000), big('users', 5)]);
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        await tick('orders', 'users');
        fireEvent.change(modeSelect('users'), {
            target: { value: 'structure' },
        });
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        fireEvent.click(
            await screen.findByRole('button', { name: 'Change tables' }),
        );
        expect(screen.queryByRole('alert')).toBeNull();
        expect(
            screen.getByRole('searchbox', { name: 'Filter tables' }),
        ).toHaveFocus();
        expect(start).not.toHaveBeenCalled();
    });

    it('closes the warning when the choice changes', async () => {
        mockApi(mixCaps(), [big('orders', 1_200_000), big('users', 5)]);
        open();
        await tick('orders', 'users');
        fireEvent.change(modeSelect('users'), {
            target: { value: 'structure' },
        });
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        await screen.findByRole('alert');
        fireEvent.change(modeSelect('orders'), {
            target: { value: 'structure' },
        });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('does not warn under the threshold', async () => {
        mockApi(mixCaps(), [big('orders', 999_999), big('users', null)]);
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        await tick('orders', 'users');
        fireEvent.change(modeSelect('users'), { target: { value: 'data' } });
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(/slower than/)).toBeNull();
    });

    it('does not warn when native covers the mix, however big', async () => {
        mockApi(caps({ mix_needs_builtin: false }), [
            big('orders', 5_000_000),
            big('users', 5),
        ]);
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        await tick('orders', 'users');
        fireEvent.change(modeSelect('users'), {
            target: { value: 'structure' },
        });
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    });

    it('does not count structure-only tables toward the warning', async () => {
        mockApi(mixCaps(), [big('orders', 5_000_000), big('users', 5)]);
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        await tick('orders', 'users');
        fireEvent.change(modeSelect('orders'), {
            target: { value: 'structure' },
        });
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    });

    it('sends no table_modes for All', async () => {
        const start = vi
            .spyOn(transfersApi, 'startExport')
            .mockResolvedValue(started);
        open();
        await tick('orders');
        fireEvent.click(screen.getByLabelText(/^All/));
        await waitFor(() => expect(backUp()).toBeEnabled());
        fireEvent.click(backUp());
        await waitFor(() => expect(start).toHaveBeenCalled());
        expect(start.mock.calls[0][1]).not.toHaveProperty('table_modes');
        expect(start.mock.calls[0][1].tables).toBe('all');
    });
});
