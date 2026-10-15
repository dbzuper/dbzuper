import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useSqlTabs } from '@/sql/tabs-store';
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
vi.mock('@/components/sql/sql-dock', () => ({
    default: () => <section aria-label="SQL editor" />,
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

const historyApi = vi.hoisted(() => ({
    list: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
}));
vi.mock('@/lib/history-api', () => ({ historyApi }));

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
    useSqlTabs.setState({ byConnection: {} });
    historyApi.list.mockResolvedValue({
        entries: [
            {
                id: 5,
                sql: 'select * from users',
                kind: 'read',
                status: 'ok',
                duration_ms: 3,
                row_count: 2,
                affected: null,
                error: null,
                created_at: new Date().toISOString(),
            },
        ],
        next_before_id: null,
    });
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

    it('toggles the SQL dock with Ctrl+J and the rail button', async () => {
        render(<WorkspaceShow connection={connection} />);
        await screen.findByText('orders');
        expect(screen.queryByRole('region', { name: 'SQL editor' })).toBeNull();
        fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
        expect(
            await screen.findByRole('region', { name: 'SQL editor' }),
        ).toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'j', metaKey: true });
        expect(screen.queryByRole('region', { name: 'SQL editor' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'SQL' }));
        expect(
            await screen.findByRole('region', { name: 'SQL editor' }),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'SQL' }));
        expect(screen.queryByRole('region', { name: 'SQL editor' })).toBeNull();
    });

    it('opens a found path in a new SQL tab', async () => {
        render(<WorkspaceShow connection={connection} />);
        await screen.findByText('orders');
        act(() => useWorkspace.getState().startPath('orders'));
        act(() => {
            useWorkspace.getState().setPaletteOpen(false);
            useWorkspace.getState().completePath('users', ['orders', 'users']);
        });
        fireEvent.click(
            await screen.findByRole('button', { name: /Open in SQL/ }),
        );
        expect(useWorkspace.getState().dockOpen).toBe(true);
        const state = useSqlTabs.getState().byConnection[1];
        const tab = state.tabs.find((t) => t.id === state.activeId);
        expect(tab?.title).toBe('Path');
        expect(tab?.sql).toContain('JOIN');
        expect(
            await screen.findByRole('region', { name: 'SQL editor' }),
        ).toBeInTheDocument();
    });

    it('opens the history panel from the rail and an entry opens the dock with its SQL', async () => {
        render(<WorkspaceShow connection={connection} />);
        await screen.findByText('orders');
        fireEvent.click(screen.getByRole('button', { name: 'History' }));
        expect(
            screen.getByRole('complementary', { name: 'History' }),
        ).toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
        expect(useWorkspace.getState().dockOpen).toBe(true);
        const state = useSqlTabs.getState().byConnection[1];
        const tab = state.tabs.find((t) => t.id === state.activeId);
        expect(tab?.sql).toBe('select * from users');
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(useWorkspace.getState().historyOpen).toBe(false);
    });

    it('opens ?history= in a new tab once without running it, keeping other params', async () => {
        historyApi.show.mockResolvedValue({
            id: 9,
            sql: 'select 1',
            kind: 'read',
            status: 'ok',
            duration_ms: 1,
            row_count: 1,
            affected: null,
            error: null,
            created_at: new Date().toISOString(),
        });
        window.history.replaceState(null, '', '/c/1?history=9&keep=1#x');
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        render(<WorkspaceShow connection={connection} />);
        await screen.findByText('orders');
        await waitFor(() =>
            expect(useWorkspace.getState().dockOpen).toBe(true),
        );
        expect(historyApi.show).toHaveBeenCalledWith(1, 9);
        const state = useSqlTabs.getState().byConnection[1];
        const tab = state.tabs.find((t) => t.id === state.activeId);
        expect(tab?.sql).toBe('select 1');
        expect(tab?.title).toBe('History');
        expect(window.location.search).toBe('?keep=1');
        expect(window.location.hash).toBe('#x');
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
        window.history.replaceState(null, '', '/');
    });

    it('ignores ?sql= and non-numeric ?history=', async () => {
        window.history.replaceState(
            null,
            '',
            '/c/1?sql=select%201&history=abc',
        );
        render(<WorkspaceShow connection={connection} />);
        await screen.findByText('orders');
        expect(historyApi.show).not.toHaveBeenCalled();
        expect(useWorkspace.getState().dockOpen).toBe(false);
        expect(useSqlTabs.getState().byConnection[1]).toBeUndefined();
        window.history.replaceState(null, '', '/');
    });

    it('tells the user when the history entry is gone', async () => {
        historyApi.show.mockRejectedValue(new Error('404'));
        window.history.replaceState(null, '', '/c/1?history=9');
        render(<WorkspaceShow connection={connection} />);
        await screen.findByText('orders');
        expect(
            await screen.findByText(
                'That history entry is no longer available.',
            ),
        ).toBeInTheDocument();
        expect(useWorkspace.getState().dockOpen).toBe(false);
        window.history.replaceState(null, '', '/');
    });
});
