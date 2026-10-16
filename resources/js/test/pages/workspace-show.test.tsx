import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowse } from '@/browse/browse-store';
import { rowsCache } from '@/browse/rows-cache';
import { useSidebarPrefs } from '@/browse/sidebar-prefs';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useRecords } from '@/records/records-store';
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
    default: ({ snapshot }: { snapshot: unknown }) => (
        <section
            aria-label="SQL editor"
            data-has-snapshot={String(snapshot !== null)}
        />
    ),
}));
vi.mock('@/components/records/records-view', () => ({
    default: () => <section aria-label="Record explorer" />,
}));
vi.mock('@/universe/webgl', () => ({ hasWebGL: () => false }));
vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: ({ count }: { count: number }) => ({
        getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
                index,
                key: index,
                start: index * 28,
                size: 28,
            })),
        getTotalSize: () => count * 28,
        scrollToIndex: vi.fn(),
    }),
}));
vi.mock('@/lib/pins-api', () => ({
    pinsApi: {
        list: vi.fn().mockResolvedValue({ pins: [] }),
        add: vi.fn(),
        remove: vi.fn(),
        reorder: vi.fn(),
    },
}));
const toast = vi.hoisted(() =>
    Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
);
vi.mock('sonner', () => ({ toast, Toaster: () => null }));

const api = vi.hoisted(() => ({
    schema: vi.fn(),
    refresh: vi.fn(),
    layout: vi.fn(),
    saveLayout: vi.fn(),
    sample: vi.fn(),
    ddl: vi.fn(),
    rows: vi.fn(() => new Promise(() => undefined)),
    count: vi.fn(() => new Promise(() => undefined)),
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

vi.mock('@/records/records-api', () => ({
    recordsApi: {
        show: vi.fn(() => new Promise(() => undefined)),
        related: vi.fn(),
    },
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
    useSqlTabs.setState({ byConnection: {} });
    useBrowse.setState({ byConnection: {} });
    useSidebarPrefs.setState({ collapsed: false });
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
    it('restores the record trail from ?r= and opens the records view', async () => {
        const { encodeTrail } = await import('@/records/url-state');
        const { openRoot } = await import('@/records/trail');
        const r = encodeTrail(openRoot('users', { id: 3 }), () => ['id']);
        window.history.replaceState(null, '', `/?r=${r}`);
        render(<WorkspaceShow connection={connection} />);
        await waitFor(() =>
            expect(useRecords.getState().trail.nodes[0]?.key).toEqual({
                id: 3,
            }),
        );
        await waitFor(() =>
            expect(useBrowse.getState().get(1).activeId).toBe('records'),
        );
        expect(
            await screen.findByRole('region', { name: 'Record explorer' }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('tab', { name: /Records · users #3/ }),
        ).toHaveAttribute('aria-selected', 'true');
        window.history.replaceState(null, '', '/');
    });

    it('binds the records store to the connection and switches tabs from the rail', async () => {
        render(<WorkspaceShow connection={connection} />);
        await screen.findByRole('treeitem', { name: /orders/ });
        expect(useRecords.getState().connectionId).toBe(1);
        const universe = screen.getByRole('button', { name: 'Universe' });
        expect(universe).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('button', { name: 'Records' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'List view' })).toBeNull();
        act(() => {
            useBrowse.getState().openTable(1, 'orders', { mode: 'permanent' });
        });
        expect(universe).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(universe);
        expect(useBrowse.getState().get(1).activeId).toBe('universe');
        expect(universe).toHaveAttribute('aria-pressed', 'true');
        window.history.replaceState(null, '', '/');
    });

    it('toggles the table sidebar from the rail', async () => {
        render(<WorkspaceShow connection={connection} />);
        await screen.findByRole('treeitem', { name: /orders/ });
        const toggle = screen.getByRole('button', {
            name: 'Toggle table sidebar',
        });
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByRole('treeitem', { name: /orders/ })).toBeNull();
        fireEvent.click(toggle);
        expect(
            await screen.findByRole('treeitem', { name: /orders/ }),
        ).toBeInTheDocument();
    });

    it('shows the WebGL message on the Universe tab and the tables in the sidebar', async () => {
        render(<WorkspaceShow connection={connection} />);
        expect(
            await screen.findByText(
                'WebGL is not available in this browser. Browse tables from the sidebar.',
            ),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('treeitem', { name: /orders/ }),
        ).toBeInTheDocument();
        expect(screen.getByText('read-only')).toBeInTheDocument();
        expect(screen.getByRole('tabpanel')).toHaveAttribute(
            'aria-labelledby',
            screen.getByRole('tab', { name: /Universe/ }).id,
        );
    });

    it('opens a table tab from the sidebar and shows it in the panel', async () => {
        render(<WorkspaceShow connection={connection} />);
        fireEvent.click(
            await screen.findByRole('treeitem', { name: /orders/ }),
        );
        expect(useBrowse.getState().get(1).activeId).toBe('t:orders');
        expect(
            screen.getByRole('heading', { name: 'orders' }),
        ).toBeInTheDocument();
        expect(screen.getByRole('tabpanel')).toHaveAttribute(
            'aria-labelledby',
            screen.getByRole('tab', { name: /orders/ }).id,
        );
        expect(new URL(window.location.href).searchParams.get('tab')).toBe(
            'orders',
        );
        window.history.replaceState(null, '', '/');
    });

    it('opens the table named by ?tab= and drops an unknown one with a toast', async () => {
        window.history.replaceState(null, '', '/c/1?tab=order+items&keep=1');
        api.schema.mockResolvedValue({
            snapshot: makeSnapshot([
                { name: 'users' },
                { name: 'order items' },
            ]),
            snapshot_id: 1,
            stored_at: new Date().toISOString(),
        });
        const { unmount } = render(<WorkspaceShow connection={connection} />);
        await waitFor(() =>
            expect(useBrowse.getState().get(1).activeId).toBe('t:order items'),
        );
        unmount();

        useBrowse.setState({ byConnection: {} });
        window.history.replaceState(null, '', '/c/1?tab=ghost&keep=1');
        render(<WorkspaceShow connection={connection} />);
        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith('Table not found: ghost'),
        );
        expect(window.location.search).toBe('?keep=1');
        expect(useBrowse.getState().get(1).activeId).toBe('universe');
        window.history.replaceState(null, '', '/');
    });

    it('reconciles tabs after a refresh, clears cached rows and says which filters were dropped', async () => {
        useBrowse.getState().openTable(1, 'orders', {
            mode: 'permanent',
            state: { filters: [{ column: 'gone', op: 'eq', value: '1' }] },
        });
        render(<WorkspaceShow connection={connection} />);
        await waitFor(() =>
            expect(toast).toHaveBeenCalledWith(
                'Filters on removed columns of orders were cleared.',
            ),
        );
        const clear = vi.spyOn(rowsCache, 'clear');
        api.refresh.mockResolvedValue({
            snapshot: makeSnapshot([{ name: 'orders' }]),
            snapshot_id: 2,
            stored_at: new Date().toISOString(),
        });
        fireEvent.click(screen.getByRole('button', { name: 'Refresh schema' }));
        await waitFor(() => expect(clear).toHaveBeenCalled());
        expect(toast).toHaveBeenCalledTimes(1);
        clear.mockRestore();
        window.history.replaceState(null, '', '/');
    });

    it('shows the inspector only on the Universe tab', async () => {
        render(<WorkspaceShow connection={connection} />);
        await screen.findByRole('treeitem', { name: /orders/ });
        act(() => useWorkspace.getState().select('users'));
        expect(
            screen.getByRole('complementary', { name: 'Inspector' }),
        ).toBeInTheDocument();
        act(() => {
            useBrowse.getState().openTable(1, 'orders', { mode: 'permanent' });
        });
        expect(
            screen.queryByRole('complementary', { name: 'Inspector' }),
        ).toBeNull();
        window.history.replaceState(null, '', '/');
    });

    it('shows the loading state before the schema arrives', () => {
        api.schema.mockReturnValue(new Promise(() => undefined));
        render(<WorkspaceShow connection={connection} />);
        expect(screen.getByText('Loading schema…')).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).toBeNull();
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

    it('opens the SQL dock even when the schema could not be loaded', async () => {
        api.schema.mockRejectedValueOnce(new Error('x'));
        render(<WorkspaceShow connection={connection} />);
        await screen.findByRole('alert');

        fireEvent.keyDown(window, { key: 'j', ctrlKey: true });

        expect(
            await screen.findByRole('region', { name: 'SQL editor' }),
        ).toHaveAttribute('data-has-snapshot', 'false');
    });

    it('keeps the selection when inferred relationships are toggled', async () => {
        render(<WorkspaceShow connection={connection} />);
        await screen.findByRole('treeitem', { name: /orders/ });
        act(() => useWorkspace.getState().select('users'));
        fireEvent.click(screen.getByRole('button', { name: 'Hide inferred' }));
        expect(useWorkspace.getState().selected).toBe('users');
    });

    it('shows the focus chip and clears focus then selection on Escape', async () => {
        render(<WorkspaceShow connection={connection} />);
        await screen.findByRole('treeitem', { name: /orders/ });
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
        await screen.findByRole('treeitem', { name: /orders/ });
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
        await screen.findByRole('treeitem', { name: /orders/ });
        act(() => useWorkspace.getState().select('users'));
        fireEvent.keyDown(screen.getByPlaceholderText('Search tables'), {
            key: 'Escape',
        });
        expect(useWorkspace.getState().selected).toBe('users');
    });

    it('toggles the SQL dock with Ctrl+J and the rail button', async () => {
        render(<WorkspaceShow connection={connection} />);
        await screen.findByRole('treeitem', { name: /orders/ });
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
        await screen.findByRole('treeitem', { name: /orders/ });
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
        await screen.findByRole('treeitem', { name: /orders/ });
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
        await screen.findByRole('treeitem', { name: /orders/ });
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
        await screen.findByRole('treeitem', { name: /orders/ });
        expect(historyApi.show).not.toHaveBeenCalled();
        expect(useWorkspace.getState().dockOpen).toBe(false);
        expect(useSqlTabs.getState().byConnection[1]).toBeUndefined();
        window.history.replaceState(null, '', '/');
    });

    it('tells the user when the history entry is gone', async () => {
        historyApi.show.mockRejectedValue(new Error('404'));
        window.history.replaceState(null, '', '/c/1?history=9');
        render(<WorkspaceShow connection={connection} />);
        await screen.findByRole('treeitem', { name: /orders/ });
        expect(
            await screen.findByText(
                'That history entry is no longer available.',
            ),
        ).toBeInTheDocument();
        expect(useWorkspace.getState().dockOpen).toBe(false);
        window.history.replaceState(null, '', '/');
    });
});
