import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/react', () => ({
    Head: () => null,
    Link: ({
        href,
        children,
        ...rest
    }: {
        href: unknown;
        children: ReactNode;
    }) => (
        <a href={String(href)} {...rest}>
            {children}
        </a>
    ),
    router: { visit: vi.fn() },
}));

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/databases-api', async (orig) => ({
    ...(await orig<typeof import('@/lib/databases-api')>()),
    databasesApi: api,
}));

import { ApiError } from '@/lib/http';
import Databases from '@/pages/connections/databases';
import type { ConnectionSummary } from '@/types/connection';

const connection: ConnectionSummary = {
    id: 5,
    ref: '5',
    name: 'Local',
    driver: 'mysql',
    driver_label: 'MySQL',
    host: 'localhost',
    port: 3306,
    database: null,
    username: 'root',
    has_password: true,
    options: {},
    read_only: false,
    color: null,
    store_history: true,
    last_opened_at: null,
    server_level: true,
    last_database: 'shop staging',
};

const entry = (
    name: string,
    over: Partial<{
        system: boolean;
        tables: number | null;
        bytes: number | null;
        openable: boolean;
    }> = {},
) => ({
    name,
    system: false,
    tables: 3,
    bytes: 2048,
    openable: true,
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    api.list.mockResolvedValue({
        databases: [
            entry('blog', { tables: 12, bytes: 5 * 1024 * 1024 }),
            entry('information_schema', { system: true }),
            entry('shop staging'),
            entry('weird;name', { openable: false }),
        ],
        last_database: 'shop staging',
        server_version: '8.4.0',
    });
});

const rows = async () =>
    within(await screen.findByRole('list', { name: 'Databases' })).getAllByRole(
        'listitem',
    );

describe('database list', () => {
    it('lists the databases with the last opened one first', async () => {
        render(<Databases connection={connection} />);

        const items = await rows();
        expect(items.map((li) => li.textContent)).toEqual([
            expect.stringContaining('shop staging'),
            expect.stringContaining('blog'),
            expect.stringContaining('weird;name'),
        ]);
        expect(within(items[0]).getByText('Last opened')).toBeInTheDocument();
        expect(within(items[1]).getByText('12 tables')).toBeInTheDocument();
        expect(within(items[1]).getByText('5 MB')).toBeInTheDocument();
        expect(api.list).toHaveBeenCalledWith(5);
    });

    it('shows the server version under the connection', async () => {
        render(<Databases connection={connection} />);

        expect(
            await screen.findByText('localhost:3306 · root · MySQL 8.4.0'),
        ).toBeInTheDocument();
    });

    it('links each database to its workspace', async () => {
        render(<Databases connection={connection} />);

        expect(
            await screen.findByRole('link', { name: /shop staging/ }),
        ).toHaveAttribute('href', '/c/5/shop%20staging');
    });

    it('shows system databases only when asked, and remembers it', async () => {
        const view = render(<Databases connection={connection} />);
        await rows();
        expect(screen.queryByText('information_schema')).toBeNull();

        fireEvent.click(
            screen.getByRole('checkbox', { name: 'Show system databases' }),
        );
        expect(screen.getByText('information_schema')).toBeInTheDocument();

        view.unmount();
        render(<Databases connection={connection} />);
        expect(
            await screen.findByText('information_schema'),
        ).toBeInTheDocument();
    });

    it('filters by name', async () => {
        render(<Databases connection={connection} />);
        await rows();

        fireEvent.change(
            screen.getByRole('searchbox', { name: 'Find a database' }),
            {
                target: { value: 'BLO' },
            },
        );

        expect((await rows()).map((li) => li.textContent)).toEqual([
            expect.stringContaining('blog'),
        ]);
    });

    it("greys out databases DBZuper can't open", async () => {
        render(<Databases connection={connection} />);
        await rows();

        expect(screen.queryByRole('link', { name: /weird;name/ })).toBeNull();
        expect(
            screen.getByText(
                "This name can't be used in a connection, so DBZuper can't open it.",
            ),
        ).toBeInTheDocument();
    });

    it('shows the database error and retries', async () => {
        api.list.mockRejectedValueOnce(
            new ApiError(422, {
                error: { kind: 'auth', message: 'Access denied for user root' },
            }),
        );
        render(<Databases connection={connection} />);

        expect(
            await screen.findByText('Access denied for user root'),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        expect(await rows()).toHaveLength(3);
        expect(api.list).toHaveBeenCalledTimes(2);
    });
});
