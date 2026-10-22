import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
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
const editorFocus = vi.hoisted(() => vi.fn());
/** Monaco commands the dock registered: keybinding -> handler. */
const commands = vi.hoisted(() => new Map<number, () => void>());
/** Edits the sync pushed into the editor's model. */
const pushEdits = vi.hoisted(() => vi.fn());
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
                    getFullModelRange: () => ({}),
                    pushStackElement: () => {},
                    pushEditOperations: pushEdits,
                    onWillDispose: () => ({ dispose: () => {} }),
                };
                onMount(
                    {
                        getModel: () => model,
                        getSelection: () => null,
                        getPosition: () => ({ lineNumber: 1, column: 1 }),
                        addCommand: (key: number, run: () => void) =>
                            commands.set(key, run),
                        focus: editorFocus,
                    },
                    {
                        editor: {
                            getModels: () => [],
                            setModelMarkers: vi.fn(),
                        },
                        KeyMod: { CtrlCmd: 1, Shift: 2 },
                        KeyCode: { Enter: 4, KeyJ: 8, KeyK: 16 },
                        MarkerSeverity: { Error: 8 },
                    },
                );
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, []);
            return <div data-testid="editor" />;
        },
    };
});

import { onTableQuery } from '@/browse/sql-link';
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
    commands.clear();
    useSqlTabs.setState({ byConnection: {} });
    useWorkspace.getState().reset();
});

describe('SqlDock', () => {
    it('lets a linked tab follow its table tab through the editor model, so the change is undoable', async () => {
        const id = useSqlTabs
            .getState()
            .openLinkedTab(1, 't:a', 'orders', 'orders', 'select 1');
        render(<SqlDock connection={connection} snapshot={null} />);
        await screen.findByTestId('editor');

        act(() => onTableQuery(1, 't:a', 'select 2'));

        expect(pushEdits).toHaveBeenCalledWith(
            [],
            [{ range: {}, text: 'select 2' }],
            expect.any(Function),
        );
        expect(
            useSqlTabs.getState().byConnection[1].tabs.find((t) => t.id === id)
                ?.sql,
        ).toBe('select 2');
    });

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

    it('keeps the previous results when a later run is cancelled', async () => {
        api.run.mockResolvedValueOnce(ok);
        render(<SqlDock connection={connection} snapshot={null} />);
        fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
        await screen.findByRole('tab', { name: /#1 SELECT/ });

        hangingRun();
        fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Cancel' }),
            ).toBeInTheDocument(),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(await screen.findByText('Cancelled.')).toBeInTheDocument();
        expect(
            screen.getByRole('tab', { name: /#1 SELECT/ }),
        ).toBeInTheDocument();
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

    describe('keyboard focus', () => {
        it('focuses the editor when the dock opens', async () => {
            render(<SqlDock connection={connection} snapshot={null} />);
            await waitFor(() => expect(editorFocus).toHaveBeenCalled());
        });

        it.each(['Cancel', 'Run UPDATE'])(
            'returns focus to the editor when the run confirmation closes via %s',
            async (button) => {
                api.run
                    .mockRejectedValueOnce(
                        new ApiError(409, {
                            confirmation: {
                                statement_index: 0,
                                mode: 'confirm',
                                kind: 'write',
                                keyword: 'UPDATE',
                                target: null,
                            },
                        }),
                    )
                    .mockResolvedValue(ok);
                render(<SqlDock connection={connection} snapshot={null} />);
                await waitFor(() => expect(editorFocus).toHaveBeenCalled());
                editorFocus.mockClear();

                fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
                fireEvent.click(
                    await screen.findByRole('button', { name: button }),
                );

                await waitFor(() =>
                    expect(editorFocus).toHaveBeenCalledTimes(1),
                );
                expect(screen.queryByRole('dialog')).toBeNull();
            },
        );
    });

    describe('workspace shortcuts while the editor has focus', () => {
        // Monaco swallows Ctrl/⌘+K (a chord prefix) and handled keys, so the dock registers them itself.
        const CTRL_CMD = 1;

        it('Ctrl/⌘+K opens the command palette', async () => {
            render(<SqlDock connection={connection} snapshot={null} />);
            await waitFor(() => expect(commands.has(CTRL_CMD | 16)).toBe(true));
            act(() => commands.get(CTRL_CMD | 16)!());
            expect(useWorkspace.getState().paletteOpen).toBe(true);
        });

        it('Ctrl/⌘+J closes the dock', async () => {
            useWorkspace.getState().setDockOpen(true);
            render(<SqlDock connection={connection} snapshot={null} />);
            await waitFor(() => expect(commands.has(CTRL_CMD | 8)).toBe(true));
            act(() => commands.get(CTRL_CMD | 8)!());
            expect(useWorkspace.getState().dockOpen).toBe(false);
        });
    });
});
