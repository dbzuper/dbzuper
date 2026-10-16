import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionSummary } from '@/types/connection';
import { useSqlTabs } from '@/sql/tabs-store';
import { useWorkspace } from '@/universe/store';

const completion = vi.hoisted(() => ({
    getter: null as null | (() => unknown),
}));
vi.mock('@/sql/monaco-completion', () => ({
    registerSqlCompletion: (_m: unknown, getter: () => unknown) => {
        completion.getter = getter;
    },
}));
vi.mock('@/sql/monaco-setup', () => ({ disposeClosedModels: vi.fn() }));

const api = vi.hoisted(() => ({ run: vi.fn(), explain: vi.fn() }));
vi.mock('@/sql/query-api', () => ({ queryApi: api }));

// Monaco cannot run in jsdom: the editor mounts a minimal fake that exposes the statement under the cursor.
vi.mock('./sql-editor', async () => {
    const { useEffect } = await import('react');
    return {
        SqlEditor: ({
            onMount,
        }: {
            onMount: (editor: unknown, monaco: unknown) => void;
        }) => {
            useEffect(() => {
                const model = {
                    getValue: () => 'select 1',
                    getOffsetAt: () => 0,
                    isDisposed: () => false,
                };
                onMount(
                    {
                        getModel: () => model,
                        getSelection: () => null,
                        getPosition: () => ({ lineNumber: 1, column: 1 }),
                        addCommand: vi.fn(),
                    },
                    {
                        editor: {
                            getModels: () => [],
                            setModelMarkers: vi.fn(),
                        },
                        KeyMod: { CtrlCmd: 1, Shift: 2 },
                        KeyCode: { Enter: 3 },
                        MarkerSeverity: { Error: 8 },
                    },
                );
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, []);
            return <div data-testid="editor" />;
        },
    };
});

import SqlDock from './sql-dock';

const connection = {
    id: 1,
    name: 'Shop',
    driver: 'sqlite',
} as ConnectionSummary;

const ok = {
    results: [
        {
            sql: 'select 1',
            kind: 'read',
            columns: [{ name: 'one', type: null, table: null }],
            rows: [[1]],
            truncated: false,
            affected: null,
            duration_ms: 1,
            error: null,
        },
    ],
};

/** A run that stays in flight until the signal aborts. */
const hangingRun = () =>
    api.run.mockImplementation(
        (_id: number, _s: unknown, _m: number, signal: AbortSignal) =>
            new Promise((_resolve, reject) =>
                signal.addEventListener('abort', () =>
                    reject(new DOMException('aborted', 'AbortError')),
                ),
            ),
    );

beforeEach(() => {
    vi.clearAllMocks();
    completion.getter = null;
    useSqlTabs.setState({ byConnection: {} });
    useWorkspace.getState().reset();
});

describe('SqlDock', () => {
    it('runs statements and shows results without a schema snapshot, with completions off', async () => {
        api.run.mockResolvedValue(ok);
        render(<SqlDock connection={connection} snapshot={null} />);

        fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));

        await waitFor(() =>
            expect(api.run).toHaveBeenCalledWith(
                1,
                [{ sql: 'select 1' }],
                expect.any(Number),
                expect.any(AbortSignal),
            ),
        );
        expect(
            await screen.findByRole('tab', { name: /#1 SELECT/ }),
        ).toBeInTheDocument();
        expect(completion.getter?.()).toBeNull();
    });

    describe('height', () => {
        const room = (px: number) =>
            vi
                .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
                .mockReturnValue(px);

        it('is clamped to the space it sits in minus 80 px, now and when the window resizes', () => {
            const spy = room(500);
            useWorkspace.getState().setDockHeight(800);
            render(<SqlDock connection={connection} snapshot={null} />);
            expect(useWorkspace.getState().dockHeight).toBe(420);
            expect(
                screen.getByRole('region', { name: 'SQL editor' }),
            ).toHaveStyle({
                height: '420px',
            });

            spy.mockReturnValue(300);
            act(() => {
                window.dispatchEvent(new Event('resize'));
            });
            expect(useWorkspace.getState().dockHeight).toBe(220);
            spy.mockRestore();
        });

        it('leaves a smaller height alone', () => {
            const spy = room(900);
            useWorkspace.getState().setDockHeight(320);
            render(<SqlDock connection={connection} snapshot={null} />);
            expect(useWorkspace.getState().dockHeight).toBe(320);
            spy.mockRestore();
        });
    });

    it('shows Running… only on the tab that is running, and Cancelled. after Cancel', async () => {
        hangingRun();
        render(<SqlDock connection={connection} snapshot={null} />);
        const first = useSqlTabs.getState().byConnection[1].activeId;
        const second = useSqlTabs.getState().openTab(1, 'select 2');
        act(() => useSqlTabs.getState().setActive(1, first));

        fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
        // Toolbar indicator plus the panel of the running tab.
        await waitFor(() =>
            expect(screen.getAllByText('Running…')).toHaveLength(2),
        );

        act(() => useSqlTabs.getState().setActive(1, second));
        expect(screen.getAllByText('Running…')).toHaveLength(1);
        expect(
            screen.getByText('Run a statement to see its results here.'),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByText('Running…')).toBeNull());
        act(() => useSqlTabs.getState().setActive(1, first));
        expect(screen.getByText('Cancelled.')).toBeInTheDocument();
    });
});
