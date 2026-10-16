import { Head } from '@inertiajs/react';
import {
    lazy,
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { toast } from 'sonner';
import { HistoryList } from '@/components/history/history-list';
import { InspectorPanel } from '@/components/inspector/inspector-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SkipLink } from '@/components/skip-link';
import { UniverseBoundary } from '@/components/universe/universe-boundary';
import { CommandPalette } from '@/components/workspace/command-palette';
import { FocusChip } from '@/components/workspace/focus-chip';
import { PathDialog } from '@/components/workspace/path-dialog';
import { PathPickChip } from '@/components/workspace/path-pick-chip';
import { LeftRail } from '@/components/workspace/left-rail';
import { TableList } from '@/components/workspace/table-list';
import { WorkspaceHeader } from '@/components/workspace/workspace-header';
import { historyApi } from '@/lib/history-api';
import { dbErrorFrom, workspaceApi } from '@/lib/workspace-api';
import { useRecords } from '@/records/records-store';
import { useTrailUrl } from '@/records/use-trail-url';
import { useSqlTabs } from '@/sql/tabs-store';
import type { ConnectionSummary } from '@/types/connection';
import type {
    DbErrorPayload,
    LayoutPositionEntry,
    SchemaResponse,
} from '@/types/schema';
import { escapeHandledElsewhere, handleEscape } from '@/universe/keyboard';
import { createLayoutSaver, type LayoutSaver } from '@/universe/layout-save';
import { useWorkspace } from '@/universe/store';
import { useDebounced } from '@/universe/use-debounced';
import { useUniverseModel } from '@/universe/use-universe-model';
import { hasWebGL } from '@/universe/webgl';

// Sigma touches the WebGL2RenderingContext global at import time, so the canvas
// is only imported after hasWebGL() says it is safe (and stays out of the main
// bundle). The chunk is prefetched while the schema loads so it is ready on first render.
const loadCanvas = () => import('@/components/universe/universe-canvas');
const UniverseCanvas = lazy(() =>
    loadCanvas().then((m) => ({
        default: m.UniverseCanvas,
    })),
);

const SqlDock = lazy(() => import('@/components/sql/sql-dock'));
// React Flow stays out of the main and workspace chunks until the records view is opened.
const RecordsView = lazy(() => import('@/components/records/records-view'));

const centered =
    'flex h-full items-center justify-center text-sm text-muted-foreground';

export default function WorkspaceShow({
    connection,
}: {
    connection: ConnectionSummary;
}) {
    const [data, setData] = useState<SchemaResponse | null>(null);
    const [saved, setSaved] = useState<LayoutPositionEntry[] | null>(null);
    const [error, setError] = useState<DbErrorPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [webgl] = useState(() => hasWebGL());
    const [renderFailed, setRenderFailed] = useState(false);
    const renderFailedRef = useRef(false);

    const view = useWorkspace((s) => s.view);
    const selected = useWorkspace((s) => s.selected);
    const select = useWorkspace((s) => s.select);
    const universeAvailable = webgl && !renderFailed;
    const universeAvailableRef = useRef(universeAvailable);
    universeAvailableRef.current = universeAvailable;

    // Keyed on the connection only: losing the universe must not wipe the selection or other state.
    useEffect(() => {
        useWorkspace.getState().reset();
        if (!universeAvailableRef.current)
            useWorkspace.getState().setView('list');
    }, [connection.id]);

    useEffect(() => {
        if (!universeAvailable) useWorkspace.getState().setView('list');
    }, [universeAvailable]);

    // Keyed on the connection only: a universe render failure must not wipe the record trail.
    useEffect(() => {
        useRecords.getState().reset();
        useRecords.getState().setConnection(connection.id);
    }, [connection.id]);

    // `?history=<id>` (from the global history page) opens that entry in a new tab once; it is never auto-run.
    const [historyNotice, setHistoryNotice] = useState<string | null>(null);
    useEffect(() => {
        const url = new URL(window.location.href);
        const raw = url.searchParams.get('history');
        if (raw === null) return;
        url.searchParams.delete('history');
        window.history.replaceState(
            window.history.state,
            '',
            url.pathname + url.search + url.hash,
        );
        if (!/^[1-9]\d{0,14}$/.test(raw)) return;
        historyApi
            .show(connection.id, Number(raw))
            .then((entry) => {
                useSqlTabs
                    .getState()
                    .openTab(connection.id, entry.sql, 'History');
                useWorkspace.getState().setDockOpen(true);
            })
            .catch(() =>
                setHistoryNotice('That history entry is no longer available.'),
            );
        // Read once on mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (universeAvailable) void loadCanvas().catch(() => undefined);
    }, [universeAvailable]);

    // One saver per connection: it remembers what the server holds, so a drag save sends only the
    // positions changed since the last save, and it drops saves made under an older layout generation.
    const saver = useMemo(
        () =>
            createLayoutSaver(
                connection.id,
                (id, entries, opts) =>
                    workspaceApi.saveLayout(id, entries, opts),
                (problem) =>
                    toast.error(
                        problem === 'too_large'
                            ? 'The layout is too large to save; some positions were not stored.'
                            : 'Could not save the layout.',
                    ),
            ),
        [connection.id],
    );
    useEffect(() => {
        if (saved) saver.baseline(saved);
    }, [saver, saved]);

    // Only the newest load may land: a slow response for a previous connection is ignored.
    const loadSeq = useRef(0);
    const load = useCallback(
        async (refresh: boolean) => {
            const seq = ++loadSeq.current;
            const isCurrent = () => seq === loadSeq.current;
            setLoading(true);
            setError(null);
            try {
                // Positions kept by an earlier unload are stored before the layout is read.
                if (!refresh) await saver.replayStored();
                const [schema, layout] = await Promise.all([
                    refresh
                        ? workspaceApi.refresh(connection.id)
                        : workspaceApi.schema(connection.id),
                    workspaceApi.layout(connection.id).catch(() => ({
                        positions: [] as LayoutPositionEntry[],
                    })),
                ]);
                if (!isCurrent()) return;
                setData(schema);
                setSaved(layout.positions);
            } catch (e) {
                if (!isCurrent()) return;
                setError(dbErrorFrom(e, 'Could not load the schema.'));
            } finally {
                if (isCurrent()) setLoading(false);
            }
        },
        [connection.id, saver],
    );

    useEffect(() => {
        // `load` changes with the connection: drop the previous connection's schema and layout first.
        setData(null);
        setSaved(null);
        void load(false);
        return () => {
            loadSeq.current++;
        };
    }, [load]);

    // Drag saves are debounced and carry their saver and generation, so one still pending when the
    // connection changes, the tab hides or the page unmounts is flushed to the right place (keepalive
    // lets it outlive the page) rather than dropped, and a stale one is discarded.
    const dragSave = useDebounced<{
        saver: LayoutSaver;
        generation: number;
        entries: LayoutPositionEntry[];
    }>((p) => p.saver.saveChanged(p.entries, p.generation), 800);
    const saveDrag = useCallback(
        (entries: LayoutPositionEntry[]) =>
            dragSave.call({ saver, generation: saver.generation(), entries }),
        [dragSave, saver],
    );

    useEffect(() => {
        const onHide = () => {
            dragSave.flush();
            saver.unload();
        };
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') onHide();
        };
        window.addEventListener('pagehide', onHide);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('pagehide', onHide);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [dragSave, saver]);

    // Leaving a connection (or the page) flushes its unsaved positions: the pending drag save carries
    // its own saver, and this cleanup unloads the one it was created for.
    useEffect(
        () => () => {
            dragSave.flush();
            saver.unload();
        },
        [dragSave, saver],
    );

    // A fresh layout (initial or re-layout) supersedes any drag save still waiting to be sent.
    const persistLaidOut = useCallback(
        (entries: LayoutPositionEntry[]) => {
            dragSave.cancel();
            saver.saveFull(entries);
        },
        [dragSave, saver],
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (
                e.key === 'Escape' &&
                !escapeHandledElsewhere(e) &&
                !useWorkspace.getState().paletteOpen &&
                handleEscape(useWorkspace.getState())
            )
                e.preventDefault();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                const st = useWorkspace.getState();
                st.setPaletteOpen(!st.paletteOpen);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
                e.preventDefault(); // browsers use Ctrl+J for downloads
                const st = useWorkspace.getState();
                if (
                    e.repeat ||
                    st.paletteOpen ||
                    document.querySelector(
                        '[role="dialog"]:not([aria-modal="false"])',
                    )
                )
                    return;
                st.setDockOpen(!st.dockOpen);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const dockOpen = useWorkspace((s) => s.dockOpen);
    const historyOpen = useWorkspace((s) => s.historyOpen);
    const pathFrom = useWorkspace((s) => s.pathFrom);
    const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);
    useEffect(() => {
        if (pathFrom) setPaletteOpen(true);
    }, [pathFrom, setPaletteOpen]);

    const snapshot = data?.snapshot ?? null;
    // `?r=` keeps the exploration trail in the URL (restore, push per change, back/forward). It must
    // come after the effect that binds the records store to the connection.
    useTrailUrl(snapshot);
    const {
        model,
        status,
        relayout: runRelayout,
    } = useUniverseModel(
        universeAvailable ? snapshot : null,
        saved,
        persistLaidOut,
    );
    // A re-layout starts a new generation at once: a drag save made before it, even one that comes
    // due while the layout is still computing, must not overwrite the result.
    const relayout = useCallback(() => {
        saver.bump();
        dragSave.cancel();
        runRelayout();
    }, [saver, dragSave, runRelayout]);
    const selectedTable = useMemo(
        () => snapshot?.tables.find((t) => t.name === selected) ?? null,
        [snapshot, selected],
    );

    // Both the error boundary and the canvas report a failure: tell the user once.
    const onRenderError = useCallback(() => {
        if (renderFailedRef.current) return;
        renderFailedRef.current = true;
        setRenderFailed(true);
        toast.error(
            'The universe could not be rendered; showing the table list instead.',
            { id: 'universe-render-failed' },
        );
    }, []);

    return (
        <div className="flex h-dvh flex-col bg-background text-foreground">
            <Head title={connection.name} />
            <SkipLink />
            <WorkspaceHeader
                connection={connection}
                storedAt={data?.stored_at ?? null}
                loading={loading}
                onRefresh={() => void load(true)}
            />

            {snapshot?.truncated && (
                <div
                    role="status"
                    className="border-b bg-warning/10 px-4 py-1.5 text-xs text-warning-foreground"
                >
                    Showing {snapshot.tables.length.toLocaleString('en')} of{' '}
                    {(
                        snapshot.total_objects ?? snapshot.tables.length
                    ).toLocaleString('en')}{' '}
                    tables and views (alphabetical). Raise
                    DBSUPERB_SCHEMA_MAX_OBJECTS to include more.
                </div>
            )}
            {historyNotice && (
                <div
                    role="status"
                    className="border-b px-4 py-1.5 text-xs text-muted-foreground"
                >
                    {historyNotice}
                </div>
            )}
            {!universeAvailable && (
                <div
                    role="status"
                    className="border-b px-4 py-1.5 text-xs text-muted-foreground"
                >
                    WebGL is not available in this browser, so the schema is
                    shown as a list.
                </div>
            )}

            <div className="flex min-h-0 flex-1">
                <LeftRail universeAvailable={universeAvailable} />

                <main
                    id="main"
                    tabIndex={-1}
                    data-testid="workspace-main"
                    className="relative min-w-0 flex-1 focus:outline-none"
                >
                    {error && (
                        <div className="absolute inset-x-0 top-0 z-10 m-4 flex items-center gap-3 rounded-md border border-destructive/40 bg-background px-3 py-2 text-sm">
                            <span role="alert" className="text-destructive">
                                {error.message}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                className="ml-auto"
                                onClick={() => void load(false)}
                            >
                                Retry
                            </Button>
                        </div>
                    )}

                    {snapshot && snapshot.tables.length === 0 && (
                        <div className={centered}>
                            This database has no tables yet.
                        </div>
                    )}

                    {snapshot &&
                        snapshot.tables.length > 0 &&
                        view === 'list' && (
                            <div className="h-full overflow-auto p-4">
                                <Input
                                    placeholder="Filter tables"
                                    value={filter}
                                    onChange={(e) => setFilter(e.target.value)}
                                    className="mb-3 w-64"
                                />
                                <div className="rounded-lg border">
                                    <TableList
                                        snapshot={snapshot}
                                        filter={filter}
                                        onSelect={(t) => select(t)}
                                        selected={selected}
                                    />
                                </div>
                            </div>
                        )}

                    {snapshot &&
                        snapshot.tables.length > 0 &&
                        view === 'universe' &&
                        universeAvailable && (
                            <>
                                {model && status === 'ready' && (
                                    <UniverseBoundary onError={onRenderError}>
                                        <Suspense
                                            fallback={
                                                <div className={centered}>
                                                    Loading universe…
                                                </div>
                                            }
                                        >
                                            <UniverseCanvas
                                                model={model}
                                                snapshot={snapshot}
                                                onRelayout={relayout}
                                                onPositionsChanged={saveDrag}
                                                onError={onRenderError}
                                            />
                                        </Suspense>
                                    </UniverseBoundary>
                                )}
                                {status === 'layout' && (
                                    <div className={centered}>
                                        Laying out{' '}
                                        {snapshot.tables.length.toLocaleString(
                                            'en',
                                        )}{' '}
                                        tables…
                                    </div>
                                )}
                                {status === 'error' && (
                                    <div
                                        role="alert"
                                        className="flex h-full items-center justify-center text-sm text-destructive"
                                    >
                                        Layout failed. Switch to the list view
                                        or refresh the schema.
                                    </div>
                                )}
                            </>
                        )}

                    {snapshot && view === 'records' && (
                        <Suspense
                            fallback={
                                <div className={centered}>Loading records…</div>
                            }
                        >
                            <RecordsView
                                connection={connection}
                                snapshot={snapshot}
                            />
                        </Suspense>
                    )}

                    {!snapshot && loading && (
                        <div className={centered}>Loading schema…</div>
                    )}
                    {snapshot && dockOpen && (
                        <Suspense fallback={null}>
                            <SqlDock
                                connection={connection}
                                snapshot={snapshot}
                            />
                        </Suspense>
                    )}
                    {snapshot && (
                        <PathDialog
                            snapshot={snapshot}
                            connectionId={connection.id}
                        />
                    )}
                    {snapshot && (
                        <CommandPalette
                            snapshot={snapshot}
                            onRefresh={() => void load(true)}
                            universeAvailable={universeAvailable}
                        />
                    )}
                    <FocusChip />
                    <PathPickChip />
                </main>

                {historyOpen && (
                    <aside
                        aria-label="History"
                        className="flex w-[420px] shrink-0 flex-col border-l"
                    >
                        <HistoryList
                            connectionId={connection.id}
                            onOpen={(e) => {
                                useSqlTabs
                                    .getState()
                                    .openTab(connection.id, e.sql, 'History');
                                useWorkspace.getState().setDockOpen(true);
                            }}
                        />
                    </aside>
                )}
                {!historyOpen && selectedTable && (
                    <aside
                        aria-label="Inspector"
                        className="flex w-[420px] shrink-0 flex-col border-l"
                    >
                        <InspectorPanel
                            connectionId={connection.id}
                            snapshot={snapshot!}
                            table={selectedTable}
                        />
                    </aside>
                )}
            </div>
        </div>
    );
}
