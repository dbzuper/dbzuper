import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutPositionEntry, SchemaResponse } from '@/types/schema';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useWorkspace } from '@/universe/store';

vi.mock('@inertiajs/react', () => ({
    Head: () => null,
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
        <a href={href}>{children}</a>
    ),
}));
vi.mock('@/universe/webgl', () => ({ hasWebGL: () => true }));

const toast = vi.hoisted(() => ({
    error: vi.fn(),
    success: vi.fn(),
}));
vi.mock('sonner', () => ({
    toast: Object.assign(vi.fn(), toast),
    Toaster: () => null,
}));

type CanvasProps = {
    snapshot: { tables: { name: string }[] };
    onError: (e: unknown) => void;
    onPositionsChanged: (entries: LayoutPositionEntry[]) => void;
};
const canvas = vi.hoisted(() => ({ props: null as CanvasProps | null }));
vi.mock('@/components/universe/universe-canvas', () => ({
    UniverseCanvas: (props: CanvasProps) => {
        canvas.props = props;
        return (
            <div data-testid="fake-canvas">
                {props.snapshot.tables.map((t) => t.name).join(',')}
            </div>
        );
    },
}));

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

const conn = (id: number) => ({
    id,
    name: `Shop ${id}`,
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
});

const response = (...names: string[]): SchemaResponse => ({
    snapshot: makeSnapshot(names.map((name) => ({ name }))),
    snapshot_id: 1,
    stored_at: new Date().toISOString(),
});
const at = (table: string, x: number): LayoutPositionEntry => ({
    table,
    x,
    y: 0,
    pinned: true,
});

beforeEach(() => {
    vi.clearAllMocks();
    canvas.props = null;
    useWorkspace.getState().reset();
    api.saveLayout.mockResolvedValue({ saved: true });
    api.layout.mockResolvedValue({
        positions: [at('users', 0), at('orders', 10)],
    });
    api.schema.mockResolvedValue(response('users', 'orders'));
});

async function mount(id = 1) {
    const view = render(<WorkspaceShow connection={conn(id)} />);
    await waitFor(() => expect(canvas.props).not.toBeNull());
    return view;
}

describe('universe render failure', () => {
    it('shows the failure toast once however many layers report it', async () => {
        await mount();
        act(() => {
            canvas.props!.onError(new Error('boom'));
            canvas.props!.onError(new Error('boom again'));
        });
        expect(toast.error).toHaveBeenCalledTimes(1);
    });

    it('falls back to the list but keeps the selection', async () => {
        await mount();
        act(() => useWorkspace.getState().select('users'));
        act(() => canvas.props!.onError(new Error('boom')));
        expect(useWorkspace.getState().view).toBe('list');
        expect(useWorkspace.getState().selected).toBe('users');
    });
});

describe('connection change', () => {
    it('ignores a slow load from the previous connection', async () => {
        let resolveOld!: (r: SchemaResponse) => void;
        api.schema.mockImplementation((id: number) =>
            id === 1
                ? new Promise<SchemaResponse>((r) => (resolveOld = r))
                : Promise.resolve(response('new_table')),
        );
        const view = render(<WorkspaceShow connection={conn(1)} />);
        view.rerender(<WorkspaceShow connection={conn(2)} />);
        await waitFor(() =>
            expect(view.getByTestId('fake-canvas')).toHaveTextContent(
                'new_table',
            ),
        );
        await act(async () => resolveOld(response('old_table')));
        expect(view.getByTestId('fake-canvas')).toHaveTextContent('new_table');
        expect(view.queryByText(/old_table/)).toBeNull();
    });

    it('flushes a pending drag save to the old connection', async () => {
        const view = await mount(1);
        act(() =>
            canvas.props!.onPositionsChanged([
                at('users', 99),
                at('orders', 10),
            ]),
        );
        expect(api.saveLayout).not.toHaveBeenCalled();
        view.rerender(<WorkspaceShow connection={conn(2)} />);
        expect(api.saveLayout).toHaveBeenCalledExactlyOnceWith(
            1,
            [at('users', 99)],
            { keepalive: true, merge: true },
        );
    });

    it('sends only changed positions, merged, with keepalive when the page hides', async () => {
        await mount();
        act(() =>
            canvas.props!.onPositionsChanged([
                at('users', 99),
                at('orders', 10),
            ]),
        );
        act(() => void window.dispatchEvent(new Event('pagehide')));
        expect(api.saveLayout).toHaveBeenCalledExactlyOnceWith(
            1,
            [at('users', 99)],
            { keepalive: true, merge: true },
        );
    });

    it('sends a normal debounced drag save as a plain merge', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            await mount();
            act(() =>
                canvas.props!.onPositionsChanged([
                    at('users', 99),
                    at('orders', 10),
                ]),
            );
            await act(async () => void vi.advanceTimersByTime(1000));
            expect(api.saveLayout).toHaveBeenCalledExactlyOnceWith(
                1,
                [at('users', 99)],
                { keepalive: false, merge: true },
            );
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('kept layout positions', () => {
    afterEach(() => localStorage.clear());

    it('are replayed as a merge before the layout is read, then cleared', async () => {
        localStorage.setItem(
            'dbsuperb.layout-pending.1',
            JSON.stringify([at('users', 55)]),
        );
        const order: string[] = [];
        api.saveLayout.mockImplementation(async () => {
            order.push('save');
            return { saved: true };
        });
        api.layout.mockImplementation(async () => {
            order.push('layout');
            return { positions: [at('users', 55), at('orders', 10)] };
        });
        await mount();
        expect(api.saveLayout).toHaveBeenCalledWith(1, [at('users', 55)], {
            keepalive: false,
            merge: true,
        });
        expect(order.slice(0, 2)).toEqual(['save', 'layout']);
        expect(localStorage.getItem('dbsuperb.layout-pending.1')).toBeNull();
    });
});
