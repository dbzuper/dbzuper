import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const inertia = vi.hoisted(() => ({ router: { visit: vi.fn() } }));
vi.mock('@inertiajs/react', () => ({
    ...inertia,
    Link: ({ href, children }: { href: unknown; children: never }) => (
        <a href={String(href)}>{children}</a>
    ),
}));

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/databases-api', async (orig) => ({
    ...(await orig<typeof import('@/lib/databases-api')>()),
    databasesApi: api,
}));

import { DatabaseSwitcher } from './database-switcher';
import { WorkspaceHeader } from './workspace-header';

const base = {
    id: 5,
    name: 'Local',
    driver_label: 'MySQL',
    read_only: false,
    color: null,
};

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    api.list.mockResolvedValue({
        databases: [
            {
                name: 'blog',
                system: false,
                tables: 1,
                bytes: 1,
                openable: true,
            },
            {
                name: 'mysql',
                system: true,
                tables: 1,
                bytes: 1,
                openable: true,
            },
            {
                name: 'shop',
                system: false,
                tables: 1,
                bytes: 1,
                openable: true,
            },
        ],
        last_database: 'shop',
    });
});

describe('DatabaseSwitcher', () => {
    it('switches to another database of the server', async () => {
        render(
            <DatabaseSwitcher
                connection={
                    {
                        ...base,
                        ref: '5:shop',
                        database: 'shop',
                        server_level: true,
                    } as never
                }
            />,
        );

        const trigger = screen.getByRole('button', { name: /Database: shop/ });
        fireEvent.keyDown(trigger, { key: 'Enter' });
        const blog = await screen.findByRole('menuitem', { name: 'blog' });
        expect(screen.queryByRole('menuitem', { name: 'mysql' })).toBeNull();
        expect(api.list).toHaveBeenCalledWith(5);

        fireEvent.click(blog);
        expect(inertia.router.visit).toHaveBeenCalledWith('/c/5/blog');
    });

    it('filters the databases as you type and opens the first match on Enter', async () => {
        render(
            <DatabaseSwitcher
                connection={
                    {
                        ...base,
                        ref: '5:shop',
                        database: 'shop',
                        server_level: true,
                    } as never
                }
            />,
        );

        fireEvent.keyDown(
            screen.getByRole('button', { name: /Database: shop/ }),
            { key: 'Enter' },
        );
        await screen.findByRole('menuitem', { name: 'blog' });
        const search = screen.getByRole('searchbox', {
            name: 'Find a database',
        });
        fireEvent.change(search, { target: { value: 'BL' } });

        expect(
            screen.getByRole('menuitem', { name: 'blog' }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'shop' })).toBeNull();

        fireEvent.keyDown(search, { key: 'Enter' });
        expect(inertia.router.visit).toHaveBeenCalledWith('/c/5/blog');
    });

    it('says when nothing matches', async () => {
        render(
            <DatabaseSwitcher
                connection={
                    {
                        ...base,
                        ref: '5:shop',
                        database: 'shop',
                        server_level: true,
                    } as never
                }
            />,
        );

        fireEvent.keyDown(
            screen.getByRole('button', { name: /Database: shop/ }),
            { key: 'Enter' },
        );
        await screen.findByRole('menuitem', { name: 'blog' });
        fireEvent.change(
            screen.getByRole('searchbox', { name: 'Find a database' }),
            { target: { value: 'zzz' } },
        );

        expect(
            screen.getByText('No database matches "zzz"'),
        ).toBeInTheDocument();
    });

    it('offers the database list itself', async () => {
        render(
            <DatabaseSwitcher
                connection={
                    {
                        ...base,
                        ref: '5:shop',
                        database: 'shop',
                        server_level: true,
                    } as never
                }
            />,
        );

        const trigger = screen.getByRole('button', { name: /Database: shop/ });
        fireEvent.keyDown(trigger, { key: 'Enter' });
        fireEvent.click(
            await screen.findByRole('menuitem', { name: 'All databases' }),
        );
        expect(inertia.router.visit).toHaveBeenCalledWith('/c/5');
    });
});

describe('WorkspaceHeader', () => {
    it('has no switcher for a connection with a fixed database', () => {
        render(
            <WorkspaceHeader
                connection={
                    {
                        ...base,
                        ref: '5',
                        database: 'app',
                        server_level: false,
                    } as never
                }
                loading={false}
                onRefresh={() => {}}
            />,
        );

        expect(screen.queryByRole('button', { name: /Database:/ })).toBeNull();
    });

    it('shows the switcher inside one database of a server', () => {
        render(
            <WorkspaceHeader
                connection={
                    {
                        ...base,
                        ref: '5:shop',
                        database: 'shop',
                        server_level: true,
                    } as never
                }
                loading={false}
                onRefresh={() => {}}
            />,
        );

        expect(
            screen.getByRole('button', { name: /Database: shop/ }),
        ).toBeInTheDocument();
    });
});
