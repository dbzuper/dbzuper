import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useWorkspace } from '@/universe/store';

vi.mock('@inertiajs/react', () => ({
    Head: () => null,
    Link: ({
        href,
        children,
        ...rest
    }: {
        href: string;
        children: React.ReactNode;
    }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));
vi.mock('@/universe/webgl', () => ({ hasWebGL: () => false }));

const api = vi.hoisted(() => ({
    schema: vi.fn(),
    refresh: vi.fn(),
    layout: vi.fn(),
    saveLayout: vi.fn(),
    sample: vi.fn(),
    ddl: vi.fn(),
}));
vi.mock('@/lib/workspace-api', async (orig) => ({
    ...(await orig<typeof import('@/lib/workspace-api')>()),
    workspaceApi: api,
}));

import WorkspaceShow from '@/pages/workspace/show';

const connection = {
    id: 1,
    name: 'Shop',
    driver: 'sqlite' as const,
    driver_label: 'SQLite',
    host: null,
    port: null,
    database: 'x',
    username: null,
    has_password: false,
    options: {},
    read_only: true,
    color: null,
    store_history: true,
};

beforeEach(() => {
    vi.clearAllMocks();
    useWorkspace.getState().reset();
    api.layout.mockResolvedValue({ positions: [] });
    api.schema.mockResolvedValue({
        snapshot: makeSnapshot(
            [{ name: 'users' }, { name: 'orders' }],
            [{ from_table: 'orders', to_table: 'users' }],
        ),
        snapshot_id: 1,
        stored_at: new Date().toISOString(),
    });
});

describe('workspace page', () => {
    it('falls back to the list view when WebGL is unavailable', async () => {
        render(<WorkspaceShow connection={connection} />);
        expect(
            await screen.findByText(/WebGL is not available/),
        ).toBeInTheDocument();
        expect(await screen.findByText('orders')).toBeInTheDocument();
        expect(screen.getByText('read-only')).toBeInTheDocument();
    });

    it('opens the inspector slot when a table is selected from the list', async () => {
        render(<WorkspaceShow connection={connection} />);
        fireEvent.click(await screen.findByRole('button', { name: 'users' }));
        expect(useWorkspace.getState().selected).toBe('users');
        expect(
            screen.getByRole('complementary', { name: 'Inspector' }),
        ).toBeInTheDocument();
    });

    it('shows a truncation banner', async () => {
        api.schema.mockResolvedValue({
            snapshot: {
                ...makeSnapshot([{ name: 'a' }]),
                truncated: true,
                total_objects: 9000,
            },
            snapshot_id: 1,
            stored_at: new Date().toISOString(),
        });
        render(<WorkspaceShow connection={connection} />);
        expect(
            await screen.findByText(/Showing 1 of 9,000 tables and views/),
        ).toBeInTheDocument();
    });

    it('shows an empty state for a schema without tables', async () => {
        api.schema.mockResolvedValue({
            snapshot: makeSnapshot([]),
            snapshot_id: 1,
            stored_at: new Date().toISOString(),
        });
        render(<WorkspaceShow connection={connection} />);
        expect(
            await screen.findByText('This database has no tables yet.'),
        ).toBeInTheDocument();
    });

    it('shows the API error and lets the user retry', async () => {
        api.schema.mockRejectedValueOnce(new Error('x'));
        render(<WorkspaceShow connection={connection} />);
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Could not load the schema.',
        );
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(api.schema).toHaveBeenCalledTimes(2));
    });
    it('keeps the selection when inferred relationships are toggled', async () => {
        render(<WorkspaceShow connection={connection} />);
        await screen.findByText('orders');
        act(() => useWorkspace.getState().select('users'));
        fireEvent.click(screen.getByRole('button', { name: 'Hide inferred' }));
        expect(useWorkspace.getState().selected).toBe('users');
    });

    it('shows the focus chip and clears focus then selection on Escape', async () => {
        render(<WorkspaceShow connection={connection} />);
        await screen.findByText('orders');
        act(() => {
            useWorkspace.getState().select('users');
            useWorkspace.getState().setFocus('users');
        });
        expect(
            screen.getByRole('button', { name: 'Exit focus' }),
        ).toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(useWorkspace.getState().focus).toBeNull();
        expect(useWorkspace.getState().selected).toBe('users');
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(useWorkspace.getState().selected).toBeNull();
    });

    it('closes only the palette when Escape dismisses it', async () => {
        render(<WorkspaceShow connection={connection} />);
        await screen.findByText('orders');
        act(() => {
            useWorkspace.getState().select('users');
            useWorkspace.getState().setFocus('users');
            useWorkspace.getState().setPaletteOpen(true);
        });
        const input = await screen.findByPlaceholderText(
            'Search tables, columns and actions…',
        );
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(useWorkspace.getState().paletteOpen).toBe(false);
        expect(useWorkspace.getState().focus).toEqual({
            table: 'users',
            depth: 1,
        });
        expect(useWorkspace.getState().selected).toBe('users');
    });

    it('ignores Escape typed into a text field', async () => {
        render(<WorkspaceShow connection={connection} />);
        await screen.findByText('orders');
        act(() => useWorkspace.getState().select('users'));
        fireEvent.keyDown(screen.getByPlaceholderText('Filter tables'), {
            key: 'Escape',
        });
        expect(useWorkspace.getState().selected).toBe('users');
    });
});
