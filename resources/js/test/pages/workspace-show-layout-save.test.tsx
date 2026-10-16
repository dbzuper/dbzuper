import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutPositionEntry } from '@/types/schema';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useWorkspace } from '@/universe/store';

vi.mock('@inertiajs/react', () => ({
    Head: () => null,
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
        <a href={href}>{children}</a>
    ),
}));
vi.mock('@/universe/webgl', () => ({ hasWebGL: () => true }));

type CanvasProps = {
    onRelayout: () => void;
    onPositionsChanged: (entries: LayoutPositionEntry[]) => void;
};
const canvas = vi.hoisted(() => ({ props: null as CanvasProps | null }));
vi.mock('@/components/universe/universe-canvas', () => ({
    UniverseCanvas: (props: CanvasProps) => {
        canvas.props = props;
        return <div data-testid="fake-canvas" />;
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

const savedLayout: LayoutPositionEntry[] = [
    { table: 'users', x: 0, y: 0, pinned: false },
    { table: 'orders', x: 10, y: 0, pinned: false },
];
const dragged: LayoutPositionEntry[] = [
    { table: 'users', x: 99, y: 99, pinned: true },
    { table: 'orders', x: 10, y: 0, pinned: false },
];

beforeEach(() => {
    vi.clearAllMocks();
    canvas.props = null;
    useWorkspace.getState().reset();
    api.saveLayout.mockResolvedValue({ saved: true });
    api.layout.mockResolvedValue({ positions: savedLayout });
    api.schema.mockResolvedValue({
        snapshot: makeSnapshot(
            [{ name: 'users' }, { name: 'orders' }],
            [{ from_table: 'orders', to_table: 'users' }],
        ),
        snapshot_id: 1,
        stored_at: new Date().toISOString(),
    });
});
afterEach(() => vi.useRealTimers());

async function mountCanvas() {
    const view = render(<WorkspaceShow connection={connection} />);
    await waitFor(() => expect(canvas.props).not.toBeNull());
    return view;
}

describe('workspace layout saving', () => {
    it('saves a pending drag when the page is hidden, with keepalive', async () => {
        await mountCanvas();
        act(() => canvas.props!.onPositionsChanged(dragged));
        expect(api.saveLayout).not.toHaveBeenCalled();
        act(() => void window.dispatchEvent(new Event('pagehide')));
        expect(api.saveLayout).toHaveBeenCalledExactlyOnceWith(
            1,
            [dragged[0]],
            {
                keepalive: true,
                merge: true,
            },
        );
    });

    it('saves a pending drag when the tab becomes hidden', async () => {
        await mountCanvas();
        act(() => canvas.props!.onPositionsChanged(dragged));
        const visibility = vi
            .spyOn(document, 'visibilityState', 'get')
            .mockReturnValue('hidden');
        act(() => void document.dispatchEvent(new Event('visibilitychange')));
        visibility.mockRestore();
        expect(api.saveLayout).toHaveBeenCalledExactlyOnceWith(
            1,
            [dragged[0]],
            {
                keepalive: true,
                merge: true,
            },
        );
    });

    it('saves a pending drag when the page unmounts', async () => {
        const view = await mountCanvas();
        act(() => canvas.props!.onPositionsChanged(dragged));
        view.unmount();
        expect(api.saveLayout).toHaveBeenCalledExactlyOnceWith(
            1,
            [dragged[0]],
            {
                keepalive: true,
                merge: true,
            },
        );
    });

    it('does not let a stale drag save overwrite a re-layout', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        await mountCanvas();
        act(() => canvas.props!.onPositionsChanged(dragged));
        act(() => canvas.props!.onRelayout());
        await waitFor(() => expect(api.saveLayout).toHaveBeenCalled());
        const relaidOut = api.saveLayout.mock.calls[0][1];
        await act(async () => void vi.advanceTimersByTime(2000));
        expect(api.saveLayout).toHaveBeenCalledTimes(1);
        expect(relaidOut).not.toEqual(dragged);
    });
});
