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
/** The fake editor's text (the statement at the cursor is its first one). */
const editorText = vi.hoisted(() => ({ value: 'select 1' }));
/** The fake editor's selected text; null = no selection (the statement at the cursor runs). */
const editorSelection = vi.hoisted(() => ({ value: null as string | null }));
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
                    getValue: () => editorText.value,
                    getValueInRange: () => editorSelection.value ?? '',
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
                        getSelection: () =>
                            editorSelection.value === null
                                ? null
                                : {
                                      isEmpty: () => false,
                                      getStartPosition: () => ({
                                          lineNumber: 1,
                                          column: 1,
                                      }),
                                  },
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

import { useBrowse, type TableTab } from '@/browse/browse-store';
import { rowsCache } from '@/browse/rows-cache';
import { onTableQuery, openTableTabInSql } from '@/browse/sql-link';
import { tableTabOf } from '@/test/browse-tabs';
import type { SchemaSnapshot, TableSchema } from '@/types/schema';
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
    editorText.value = 'select 1';
    editorSelection.value = null;
    useSqlTabs.setState({ byConnection: {} });
    useBrowse.setState({ byConnection: {} });
    rowsCache.clear();
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

const ordersTable: TableSchema = {
    name: 'orders',
    kind: 'table',
    row_count: { count: null, kind: 'unknown' },
    size_bytes: null,
    primary_key: ['id'],
    columns: ['id', 'status'].map((name) => ({
        name,
        type: name === 'id' ? 'integer' : 'text',
        type_name: name === 'id' ? 'integer' : 'text',
        nullable: false,
        default: null,
        auto_increment: name === 'id',
        comment: null,
    })),
    indexes: [
        { name: 'primary', columns: ['id'], unique: true, primary: true },
    ],
};
const snapshotWith = (tables: TableSchema[]): SchemaSnapshot => ({
    driver: 'sqlite',
    database: 'shop',
    schema: null,
    generated_at: '',
    hash: '',
    tables,
    relationships: [],
});

describe('linked editor tabs', () => {
    const orders = () => tableTabOf(1, 'orders') as TableTab;
    const browse = () => useBrowse.getState().get(1);
    const editorTab = (id: string) =>
        useSqlTabs.getState().byConnection[1].tabs.find((t) => t.id === id);
    const renderDock = (tables: TableSchema[] | null = [ordersTable]) =>
        render(
            <SqlDock
                connection={connection}
                snapshot={tables && snapshotWith(tables)}
            />,
        );

    /** `orders` open in a table tab, its linked editor tab active, and another table tab active in the browser. */
    function setup(text: string) {
        useBrowse.getState().openTable(1, 'orders', { mode: 'permanent' });
        const id = openTableTabInSql(1, orders(), 'sqlite', []);
        useSqlTabs.getState().setSql(1, id, text);
        editorText.value = text;
        useBrowse.getState().openTable(1, 'users', { mode: 'permanent' });
        return id;
    }

    describe('Run', () => {
        it('applies a fitting statement to the table tab without the query API or history', async () => {
            const id = setup("select * from orders where status = 'paid'");
            const runs = useWorkspace.getState().runCount;
            renderDock();

            fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));

            expect(await screen.findByText(/Applied to/)).toHaveTextContent(
                'Applied to orders',
            );
            expect(api.run).not.toHaveBeenCalled();
            expect(useWorkspace.getState().runCount).toBe(runs);
            expect(orders().state.filters).toEqual([
                { column: 'status', op: 'eq', value: 'paid' },
            ]);
            expect(browse().activeId).toBe(orders().id);
            expect(editorTab(id)?.link?.browseTabId).toBe(orders().id);
            expect(screen.queryByRole('tab', { name: /#1 SELECT/ })).toBeNull();
        });

        it('Run all with exactly one statement applies too', async () => {
            setup("select * from orders where status = 'paid';");
            renderDock();
            fireEvent.click(screen.getByRole('button', { name: /^Run all/ }));
            expect(await screen.findByText(/Applied to/)).toBeInTheDocument();
            expect(api.run).not.toHaveBeenCalled();
        });

        it('Run all with several statements runs them as today', async () => {
            api.run.mockResolvedValue(ok);
            setup("select * from orders where status = 'paid'; select 1");
            renderDock();
            fireEvent.click(screen.getByRole('button', { name: /^Run all/ }));
            await waitFor(() => expect(api.run).toHaveBeenCalled());
            await screen.findByRole('tab', { name: /#1 SELECT/ });
            expect(screen.queryByText(/Shown here/)).toBeNull();
            expect(orders().state.filters).toEqual([]);
        });

        it('runs a statement that does not fit in the editor, says why, and leaves the table tab alone', async () => {
            api.run.mockResolvedValue(ok);
            const id = setup(
                'select status, count(*) from orders group by status',
            );
            renderDock();

            fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));

            await waitFor(() => expect(api.run).toHaveBeenCalled());
            const line = await screen.findByText(/^Shown here:/);
            expect(line).toHaveAttribute('role', 'status');
            expect(line.textContent).not.toContain('`');
            expect(
                screen.getByRole('tab', { name: /#1 SELECT/ }),
            ).toBeInTheDocument();
            expect(orders().state.filters).toEqual([]);
            expect(browse().activeId).not.toBe(orders().id);
            expect(editorTab(id)?.link?.browseTabId).toBe(orders().id);
        });

        it('runs in the editor when the linked table is gone from the schema', async () => {
            api.run.mockResolvedValue(ok);
            setup('select * from orders');
            renderDock([]);
            fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
            await waitFor(() => expect(api.run).toHaveBeenCalled());
            const line = await screen.findByText(/^Shown here:/);
            expect(line).toHaveTextContent(
                'Shown here: orders no longer exists',
            );
            expect(line.querySelector('code')).toHaveTextContent('orders');
        });

        it('shows backticked parts of the reason as code, not raw backticks', async () => {
            api.run.mockResolvedValue(ok);
            setup('select distinct status from orders');
            renderDock();
            fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
            const line = await screen.findByText(/^Shown here:/);
            expect(line).toHaveTextContent('Shown here: DISTINCT');
            expect(line.textContent).not.toContain('`');
            const code = line.querySelector('code');
            expect(code).toHaveTextContent('DISTINCT');
            expect(code).toHaveClass('font-mono');
        });

        it('runs in the editor when the linked table tab itself is gone, never saying Applied', async () => {
            api.run.mockResolvedValue(ok);
            const id = setup("select * from orders where status = 'paid'");
            const link = editorTab(id)!.link!;
            useSqlTabs
                .getState()
                .setLink(1, id, { ...link, browseTabId: 'gone' });
            renderDock();
            fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
            await waitFor(() => expect(api.run).toHaveBeenCalled());
            expect(await screen.findByText(/^Shown here:/)).toHaveTextContent(
                'Shown here: orders no longer exists',
            );
            expect(screen.queryByText(/Applied to/)).toBeNull();
            expect(orders().state.filters).toEqual([]);
        });

        it('a selection that is not the whole single statement links only the selection', async () => {
            const id = setup(
                "select * from orders where status = 'paid' order by id desc",
            );
            editorSelection.value =
                "select * from orders where status = 'paid'";
            renderDock();
            fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
            expect(await screen.findByText(/Applied to/)).toBeInTheDocument();
            expect(orders().state.sort).toEqual([]);
            expect(editorTab(id)?.link?.syncedSql).toBe(
                "select * from orders where status = 'paid'",
            );
            // A later table change marks the link stale instead of replacing the text.
            act(() => onTableQuery(1, orders().id, 'select 2'));
            expect(editorTab(id)?.sql).toBe(
                "select * from orders where status = 'paid' order by id desc",
            );
            expect(editorTab(id)?.link?.stale).toBe(true);
        });

        it('a selection of the whole single statement (with its semicolon) links the whole text', async () => {
            const text = "select * from orders where status = 'paid';";
            const id = setup(text);
            editorSelection.value = text;
            renderDock();
            fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
            expect(await screen.findByText(/Applied to/)).toBeInTheDocument();
            expect(editorTab(id)?.link?.syncedSql).toBe(text);
        });

        it('Explain on a linked tab is not intercepted', async () => {
            api.explain.mockResolvedValue(ok);
            setup("select * from orders where status = 'paid'");
            renderDock();
            fireEvent.click(screen.getByRole('button', { name: /^Explain/ }));
            await waitFor(() =>
                expect(api.explain).toHaveBeenCalledWith(
                    1,
                    "select * from orders where status = 'paid'",
                    expect.anything(),
                ),
            );
            expect(screen.queryByText(/Applied to/)).toBeNull();
            expect(orders().state.filters).toEqual([]);
        });

        it('a destructive statement in a linked tab still asks for confirmation', async () => {
            api.run
                .mockRejectedValueOnce(
                    new ApiError(409, {
                        confirmation: {
                            statement_index: 0,
                            mode: 'confirm',
                            kind: 'write',
                            keyword: 'DELETE',
                            target: null,
                        },
                    }),
                )
                .mockResolvedValue(ok);
            setup('delete from orders');
            renderDock();
            fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
            expect(await screen.findByRole('dialog')).toBeInTheDocument();
            fireEvent.click(
                await screen.findByRole('button', { name: 'Run DELETE' }),
            );
            await waitFor(() => expect(api.run).toHaveBeenCalledTimes(2));
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(screen.queryByText(/Applied to/)).toBeNull();
        });

        it('an unlinked tab runs as today, with no chip', async () => {
            api.run.mockResolvedValue(ok);
            editorText.value = 'select * from orders';
            renderDock();
            fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
            await waitFor(() => expect(api.run).toHaveBeenCalled());
            await screen.findByRole('tab', { name: /#1 SELECT/ });
            expect(screen.queryByText(/Shown here/)).toBeNull();
            expect(screen.queryByText(/Linked to/)).toBeNull();
        });

        it('a closed link never applies, and the chip says the table tab was closed', async () => {
            api.run.mockResolvedValue(ok);
            setup('select * from orders');
            act(() => useBrowse.getState().closeTab(1, orders().id));
            renderDock();
            expect(screen.getByText(/^Unlinked:/)).toHaveTextContent(
                'Unlinked: orders was closed',
            );
            fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
            await waitFor(() => expect(api.run).toHaveBeenCalled());
            await screen.findByRole('tab', { name: /#1 SELECT/ });
            expect(screen.queryByText(/Shown here/)).toBeNull();
        });
    });

    describe('chip', () => {
        it('Copy to new tab opens an unlinked tab with the same text', async () => {
            const id = setup('select * from orders -- mine');
            renderDock();
            fireEvent.keyDown(
                screen.getByRole('button', { name: /Linked to orders/ }),
                { key: 'Enter' },
            );
            fireEvent.click(
                await screen.findByRole('menuitem', {
                    name: 'Copy to new tab',
                }),
            );
            const state = useSqlTabs.getState().byConnection[1];
            const copy = state.tabs.find((t) => t.id === state.activeId)!;
            expect(copy.id).not.toBe(id);
            expect(copy.sql).toBe('select * from orders -- mine');
            expect(copy.link).toBeUndefined();
            expect(editorTab(id)?.link).toBeDefined();
        });

        it('Unlink removes the link', async () => {
            const id = setup('select * from orders');
            renderDock();
            fireEvent.keyDown(
                screen.getByRole('button', { name: /Linked to orders/ }),
                { key: 'Enter' },
            );
            fireEvent.click(
                await screen.findByRole('menuitem', { name: 'Unlink' }),
            );
            expect(editorTab(id)?.link).toBeUndefined();
            expect(screen.queryByText(/Linked to/)).toBeNull();
        });

        it('when stale, Update SQL replaces the text with the table query', async () => {
            const id = setup('my edit');
            act(() => onTableQuery(1, orders().id, 'select 2'));
            renderDock();
            expect(screen.getByText(/changed/)).toHaveTextContent(
                'orders changed',
            );
            fireEvent.click(screen.getByRole('button', { name: 'Update SQL' }));
            expect(editorTab(id)?.sql).toBe('select 2');
            expect(editorTab(id)?.link?.stale).toBeFalsy();
            expect(
                screen.getByRole('button', { name: /Linked to orders/ }),
            ).toBeInTheDocument();
        });

        it('Update SQL is disabled, with a reason, when no table query is known', () => {
            const id = setup('my edit');
            act(() => onTableQuery(1, orders().id, 'select 2'));
            const link = editorTab(id)!.link!;
            act(() =>
                useSqlTabs
                    .getState()
                    .setLink(1, id, { ...link, browseTabId: 'gone' }),
            );
            renderDock();
            const button = screen.getByRole('button', { name: 'Update SQL' });
            expect(button).toBeDisabled();
            expect(button.closest('[title]')).toHaveAttribute(
                'title',
                expect.stringMatching(/isn't known/),
            );
        });
    });
});
