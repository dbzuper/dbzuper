import { X } from 'lucide-react';
import type * as Monaco from 'monaco-editor';
import { useCallback, useEffect, useRef, useState } from 'react';
import { registerEditorModel } from '@/browse/sql-link';
import { Button } from '@/components/ui/button';
import {
    toggleDock,
    togglePalette,
    toggleSidebar,
} from '@/lib/workspace-shortcuts';
import { registerSqlCompletion } from '@/sql/monaco-completion';
import { disposeClosedModels } from '@/sql/monaco-setup';
import { queryApi } from '@/sql/query-api';
import {
    outcomeFromError,
    runWithConfirmations,
    type ConfirmAnswer,
    type RunOutcome,
} from '@/sql/run-query';
import { splitStatements, statementAt } from '@/sql/splitter';
import { useSqlTabs } from '@/sql/tabs-store';
import type { ConnectionSummary } from '@/types/connection';
import type {
    ConfirmationPayload,
    DbErrorPayload,
    Dialect,
    SchemaSnapshot,
    StatementResultPayload,
} from '@/types/schema';
import { useWorkspace } from '@/universe/store';
import { DOCK_ID, DockSeparator } from './dock-separator';
import { ConfirmDialog, type ConfirmRequest } from './confirm-dialog';
import { ResultPanel } from './result-panel';
import { SqlEditor } from './sql-editor';
import { SqlTabsBar } from './sql-tabs-bar';
import { DEFAULT_ROW_LIMIT, SqlToolbar } from './sql-toolbar';

const MARKER_OWNER = 'dbsuperb';
const NO_RESULTS: StatementResultPayload[] = [];

type TabResults = {
    results: StatementResultPayload[];
    error: DbErrorPayload | null;
    rolledBack?: boolean;
    cancelled?: boolean;
};

/** The dock leaves this much of the workspace visible above it. */
const DOCK_HEADROOM = 80;

/** Statement texts plus each one's start offset in the full model text. */
type RunTarget = { statements: string[]; offsets: number[] };

export default function SqlDock({
    connection,
    snapshot,
}: {
    connection: ConnectionSummary;
    /** Null when introspection failed: SQL still runs, only completions are off. */
    snapshot: SchemaSnapshot | null;
}) {
    const height = useWorkspace((s) => s.dockHeight);
    const setHeight = useWorkspace((s) => s.setDockHeight);
    const setOpen = useWorkspace((s) => s.setDockOpen);
    const section = useRef<HTMLElement>(null);

    // The dock never covers the whole workspace: it is clamped to the space it sits in (minus a strip of
    // headroom) when it opens, when it is resized and when the window is.
    useEffect(() => {
        const clamp = () => {
            const room = section.current?.parentElement?.clientHeight ?? 0;
            const max = room - DOCK_HEADROOM;
            if (max > 0 && useWorkspace.getState().dockHeight > max)
                setHeight(max);
        };
        clamp();
        window.addEventListener('resize', clamp);
        return () => window.removeEventListener('resize', clamp);
    }, [height, setHeight]);
    const tabs = useSqlTabs((s) => s.byConnection[connection.id]);
    const ensure = useSqlTabs((s) => s.ensure);
    const setSql = useSqlTabs((s) => s.setSql);
    // The completion provider is registered once; it reads the latest schema through this ref.
    const context = useRef({ snapshot });
    useEffect(() => {
        context.current = { snapshot };
    });

    useEffect(() => ensure(connection.id), [connection.id, ensure]);
    const active = tabs?.tabs.find((t) => t.id === tabs.activeId);

    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);
    // A closed tab's model would otherwise live (with its undo history) until the page unloads. Runs after the
    // editor has switched to the next tab's model; tabs of another connection are left alone.
    const knownTabs = useRef<{ connectionId: number; ids: string[] } | null>(
        null,
    );
    useEffect(() => {
        const ids = tabs?.tabs.map((t) => t.id) ?? [];
        const previous = knownTabs.current;
        knownTabs.current = { connectionId: connection.id, ids };
        if (monacoRef.current && previous?.connectionId === connection.id)
            disposeClosedModels(monacoRef.current, previous.ids, ids);
    }, [connection.id, tabs]);
    const controller = useRef<AbortController | null>(null);
    const pendingConfirm = useRef<((a: ConfirmAnswer) => void) | null>(null);
    const [maxRows, setMaxRows] = useState(DEFAULT_ROW_LIMIT);
    // The tab whose statement is in flight (one run at a time, dock-wide).
    const [runningTab, setRunningTab] = useState<string | null>(null);
    const runningRef = useRef(false);
    const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
        null,
    );
    // Results live per tab for the lifetime of the dock; they are not persisted.
    const [resultsByTab, setResultsByTab] = useState<
        Record<string, TabResults>
    >({});

    const clearMarkers = useCallback(() => {
        const monaco = monacoRef.current;
        if (!monaco) return;
        for (const model of monaco.editor.getModels())
            monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    }, []);

    // Markers describe the previous tab's statement, so they go when the tab changes.
    const activeId = active?.id;
    useEffect(() => clearMarkers(), [activeId, clearMarkers]);

    // The model now in the editor is the active tab's (the editor switches models before this runs); a linked tab
    // that follows its table tab edits it, so the change is undoable. It stays registered until disposed.
    const [editorMounts, setEditorMounts] = useState(0);
    useEffect(() => {
        const model = editorRef.current?.getModel();
        if (activeId && model) registerEditorModel(activeId, model);
    }, [activeId, editorMounts]);

    const resolveConfirm = useCallback((answer: ConfirmAnswer) => {
        pendingConfirm.current?.(answer);
        pendingConfirm.current = null;
        setConfirmRequest(null);
    }, []);

    const cancel = useCallback(() => {
        controller.current?.abort();
        resolveConfirm(null);
    }, [resolveConfirm]);

    // Closing the dock aborts an in-flight run and cancels a pending confirmation.
    const cancelRef = useRef(cancel);
    useEffect(() => {
        cancelRef.current = cancel;
    });
    useEffect(() => () => cancelRef.current(), []);

    const dialect: Dialect = connection.driver;

    /** The selected text split into statements, or the statement at the cursor. */
    const currentTarget = useCallback((): RunTarget | null => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        if (!editor || !model) return null;
        const selection = editor.getSelection();
        if (selection && !selection.isEmpty()) {
            const base = model.getOffsetAt(selection.getStartPosition());
            const parts = splitStatements(
                model.getValueInRange(selection),
                dialect,
            );
            return {
                statements: parts.map((p) => p.sql),
                offsets: parts.map((p) => base + p.start),
            };
        }
        const position = editor.getPosition();
        const found = statementAt(
            model.getValue(),
            position ? model.getOffsetAt(position) : 0,
            dialect,
        );
        return found
            ? { statements: [found.sql], offsets: [found.start] }
            : { statements: [], offsets: [] };
    }, [dialect]);

    const allTarget = useCallback((): RunTarget | null => {
        const model = editorRef.current?.getModel();
        if (!model) return null;
        const parts = splitStatements(model.getValue(), dialect);
        return {
            statements: parts.map((p) => p.sql),
            offsets: parts.map((p) => p.start),
        };
    }, [dialect]);

    const execute = useCallback(
        async (
            target: RunTarget | null,
            call: (signal: AbortSignal) => Promise<RunOutcome>,
            markErrors: boolean,
        ) => {
            const editor = editorRef.current;
            const monaco = monacoRef.current;
            const model = editor?.getModel();
            const tabId =
                useSqlTabs.getState().byConnection[connection.id]?.activeId;
            if (!editor || !monaco || !model || !tabId || runningRef.current)
                return;
            clearMarkers();
            const show = (value: TabResults) =>
                setResultsByTab((prev) => ({ ...prev, [tabId]: value }));
            if (target && target.statements.length === 0) {
                show({
                    results: [],
                    error: {
                        kind: 'validation',
                        message: 'There is no statement to run.',
                        sqlstate: null,
                        reason: null,
                    },
                });
                return;
            }

            const abort = new AbortController();
            controller.current = abort;
            runningRef.current = true;
            setRunningTab(tabId);
            let outcome: RunOutcome;
            try {
                outcome = await call(abort.signal);
            } catch (e) {
                outcome = outcomeFromError(e);
            } finally {
                if (controller.current === abort) controller.current = null;
                runningRef.current = false;
                setRunningTab(null);
            }
            if ('cancelled' in outcome) {
                // A cancelled run (or a declined confirmation) leaves what the tab showed before.
                setResultsByTab((prev) => ({
                    ...prev,
                    [tabId]: {
                        ...(prev[tabId] ?? { results: [], error: null }),
                        cancelled: true,
                    },
                }));
                return;
            }
            if ('error' in outcome) {
                show({ results: [], error: outcome.error });
                return;
            }
            show({
                results: outcome.results,
                error: null,
                rolledBack: outcome.open_transaction_rolled_back ?? false,
            });

            if (!markErrors || !target || model.isDisposed()) return;
            const markers: Monaco.editor.IMarkerData[] = [];
            outcome.results.forEach((r, i) => {
                const position = r.error?.position;
                const offset = target.offsets[i];
                if (!r.error || !position || offset === undefined) return;
                // The server's line is relative to the statement; the column only offsets on its first line.
                const start = model.getPositionAt(offset);
                const line = start.lineNumber + position.line - 1;
                if (line > model.getLineCount()) return;
                const column = position.column
                    ? position.line === 1
                        ? start.column + position.column - 1
                        : position.column
                    : model.getLineFirstNonWhitespaceColumn(line) || 1;
                const wordEnd =
                    model.getWordAtPosition({ lineNumber: line, column })
                        ?.endColumn ?? model.getLineMaxColumn(line);
                markers.push({
                    startLineNumber: line,
                    startColumn: column,
                    endLineNumber: line,
                    endColumn: Math.max(wordEnd, column + 1),
                    message: r.error.message,
                    severity: monaco.MarkerSeverity.Error,
                });
            });
            if (markers.length > 0)
                monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
        },
        [clearMarkers, connection.id],
    );

    const confirm = useCallback(
        (confirmation: ConfirmationPayload, sql: string) =>
            new Promise<ConfirmAnswer>((resolve) => {
                pendingConfirm.current = resolve;
                setConfirmRequest({ confirmation, sql });
            }),
        [],
    );

    const runTarget = useCallback(
        async (target: RunTarget | null) => {
            await execute(
                target,
                (signal) =>
                    runWithConfirmations({
                        connectionId: connection.id,
                        statements: target?.statements ?? [],
                        maxRows,
                        signal,
                        confirm,
                    }),
                true,
            );
            // The run may have added history entries.
            useWorkspace.getState().bumpRuns();
        },
        [confirm, connection.id, execute, maxRows],
    );

    const run = useCallback(
        () => runTarget(currentTarget()),
        [currentTarget, runTarget],
    );
    const runAll = useCallback(
        () => runTarget(allTarget()),
        [allTarget, runTarget],
    );
    const explain = useCallback(() => {
        const target = currentTarget();
        const sql = target?.statements[0] ?? '';
        return execute(
            target && { statements: sql ? [sql] : [], offsets: target.offsets },
            async (signal) => {
                try {
                    return await queryApi.explain(connection.id, sql, signal);
                } catch (e) {
                    return outcomeFromError(e);
                }
            },
            false,
        );
    }, [connection.id, currentTarget, execute]);

    // Monaco commands are registered once per editor, so they call the latest handlers through this ref.
    const handlers = useRef({ run, runAll });
    useEffect(() => {
        handlers.current = { run, runAll };
    });
    const tabResults = active ? resultsByTab[active.id] : undefined;

    return (
        <section
            id={DOCK_ID}
            ref={section}
            aria-label="SQL editor"
            // Part of the workspace layout, not an overlay: the tab panel above shrinks by the dock's
            // height, so table footers and the row drawer stay reachable. At least 6rem stays above it.
            className="relative z-20 flex max-h-[calc(100%-6rem)] shrink-0 flex-col border-t bg-background"
            style={{ height }}
        >
            <DockSeparator />
            <div className="flex items-center gap-2 border-b px-2">
                <SqlTabsBar connectionId={connection.id} />
                <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-7"
                    aria-label="Close SQL editor"
                    onClick={() => setOpen(false)}
                >
                    <X className="size-4" />
                </Button>
            </div>
            <SqlToolbar
                running={runningTab !== null}
                maxRows={maxRows}
                onMaxRows={setMaxRows}
                onRun={() => void run()}
                onRunAll={() => void runAll()}
                onExplain={() => void explain()}
                onCancel={cancel}
            />
            <div className="min-h-0 flex-[45] border-b">
                {active && (
                    <SqlEditor
                        path={active.id}
                        value={active.sql}
                        dialect={dialect}
                        onChange={(sql) =>
                            setSql(connection.id, active.id, sql)
                        }
                        onMount={(editor, monaco) => {
                            editorRef.current = editor;
                            monacoRef.current = monaco;
                            setEditorMounts((n) => n + 1);
                            // Opening the dock (Ctrl/⌘+J or the rail) means "type SQL now".
                            editor.focus();
                            editor.addCommand(
                                monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
                                () => void handlers.current.run(),
                            );
                            editor.addCommand(
                                monaco.KeyMod.CtrlCmd |
                                    monaco.KeyMod.Shift |
                                    monaco.KeyCode.Enter,
                                () => void handlers.current.runAll(),
                            );
                            // The editor has focus while the dock is open and would swallow these
                            // (Ctrl/⌘+K starts a Monaco chord), so they are editor commands too.
                            editor.addCommand(
                                monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
                                () => togglePalette(),
                            );
                            editor.addCommand(
                                monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP,
                                () => togglePalette('tables'),
                            );
                            editor.addCommand(
                                monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB,
                                () => toggleSidebar(),
                            );
                            editor.addCommand(
                                monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyJ,
                                () => toggleDock(),
                            );
                            registerSqlCompletion(monaco, () => {
                                const current = context.current.snapshot;
                                return current
                                    ? {
                                          snapshot: current,
                                          dialect: current.driver as Dialect,
                                          focusedTable:
                                              useWorkspace.getState().selected,
                                      }
                                    : null;
                            });
                        }}
                    />
                )}
            </div>
            <div className="min-h-0 flex-[55]">
                <ResultPanel
                    results={tabResults?.results ?? NO_RESULTS}
                    error={tabResults?.error ?? null}
                    running={!!active && runningTab === active.id}
                    cancelled={tabResults?.cancelled ?? false}
                    snapshot={snapshot}
                    openTransactionRolledBack={tabResults?.rolledBack ?? false}
                />
            </div>
            <ConfirmDialog
                request={confirmRequest}
                onResolve={resolveConfirm}
                onCloseFocus={() => editorRef.current?.focus()}
            />
        </section>
    );
}
