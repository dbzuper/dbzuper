import { X } from 'lucide-react';
import type * as Monaco from 'monaco-editor';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { registerSqlCompletion } from '@/sql/monaco-completion';
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
};

/** Statement texts plus each one's start offset in the full model text. */
type RunTarget = { statements: string[]; offsets: number[] };

export default function SqlDock({
    connection,
    snapshot,
}: {
    connection: ConnectionSummary;
    snapshot: SchemaSnapshot;
}) {
    const height = useWorkspace((s) => s.dockHeight);
    const setHeight = useWorkspace((s) => s.setDockHeight);
    const setOpen = useWorkspace((s) => s.setDockOpen);
    const tabs = useSqlTabs((s) => s.byConnection[connection.id]);
    const ensure = useSqlTabs((s) => s.ensure);
    const setSql = useSqlTabs((s) => s.setSql);
    const drag = useRef<{ y: number; height: number } | null>(null);
    // The completion provider is registered once; it reads the latest schema through this ref.
    const context = useRef({ snapshot });
    useEffect(() => {
        context.current = { snapshot };
    });

    useEffect(() => ensure(connection.id), [connection.id, ensure]);
    const active = tabs?.tabs.find((t) => t.id === tabs.activeId);

    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);
    const controller = useRef<AbortController | null>(null);
    const pendingConfirm = useRef<((a: ConfirmAnswer) => void) | null>(null);
    const [maxRows, setMaxRows] = useState(DEFAULT_ROW_LIMIT);
    const [running, setRunning] = useState(false);
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

    const dialect = snapshot.driver as Dialect;

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
            setRunning(true);
            let outcome: RunOutcome;
            try {
                outcome = await call(abort.signal);
            } catch (e) {
                outcome = outcomeFromError(e);
            } finally {
                if (controller.current === abort) controller.current = null;
                runningRef.current = false;
                setRunning(false);
            }
            if ('cancelled' in outcome) return;
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
        (target: RunTarget | null) =>
            execute(
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
            ),
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

    const onResizeStart = (e: React.PointerEvent) => {
        drag.current = {
            y: e.clientY,
            height: useWorkspace.getState().dockHeight,
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onResizeMove = (e: React.PointerEvent) => {
        if (!drag.current) return;
        setHeight(drag.current.height + (drag.current.y - e.clientY));
    };
    const onResizeEnd = () => {
        drag.current = null;
    };

    return (
        <section
            aria-label="SQL editor"
            className="absolute inset-x-0 bottom-0 z-20 flex flex-col border-t bg-background shadow-2xl"
            style={{ height }}
        >
            <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize SQL editor"
                className="h-1.5 cursor-row-resize bg-border/60 hover:bg-[var(--universe-accent)]"
                onPointerDown={onResizeStart}
                onPointerMove={onResizeMove}
                onPointerUp={onResizeEnd}
                onPointerCancel={onResizeEnd}
                onLostPointerCapture={onResizeEnd}
            />
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
                running={running}
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
                        dialect={snapshot.driver}
                        onChange={(sql) =>
                            setSql(connection.id, active.id, sql)
                        }
                        onMount={(editor, monaco) => {
                            editorRef.current = editor;
                            monacoRef.current = monaco;
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
                            registerSqlCompletion(monaco, () => ({
                                snapshot: context.current.snapshot,
                                dialect: context.current.snapshot
                                    .driver as Dialect,
                                focusedTable: useWorkspace.getState().selected,
                            }));
                        }}
                    />
                )}
            </div>
            <div className="min-h-0 flex-[55]">
                <ResultPanel
                    results={tabResults?.results ?? NO_RESULTS}
                    error={tabResults?.error ?? null}
                    running={running}
                    snapshot={snapshot}
                    openTransactionRolledBack={tabResults?.rolledBack ?? false}
                />
            </div>
            <ConfirmDialog
                request={confirmRequest}
                onResolve={resolveConfirm}
            />
        </section>
    );
}
