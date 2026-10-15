import { Head } from '@inertiajs/react';
import {
    lazy,
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { toast } from 'sonner';
import { InspectorPanel } from '@/components/inspector/inspector-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UniverseBoundary } from '@/components/universe/universe-boundary';
import { LeftRail } from '@/components/workspace/left-rail';
import { TableList } from '@/components/workspace/table-list';
import { WorkspaceHeader } from '@/components/workspace/workspace-header';
import { dbErrorFrom, workspaceApi } from '@/lib/workspace-api';
import type { ConnectionSummary } from '@/types/connection';
import type {
    DbErrorPayload,
    LayoutPositionEntry,
    SchemaResponse,
} from '@/types/schema';
import { useWorkspace } from '@/universe/store';
import { useUniverseModel } from '@/universe/use-universe-model';
import { hasWebGL } from '@/universe/webgl';

// Sigma touches the WebGL2RenderingContext global at import time, so the canvas
// is only imported after hasWebGL() says it is safe (and stays out of the main
// bundle).
const UniverseCanvas = lazy(() =>
    import('@/components/universe/universe-canvas').then((m) => ({
        default: m.UniverseCanvas,
    })),
);

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

    const view = useWorkspace((s) => s.view);
    const selected = useWorkspace((s) => s.selected);
    const select = useWorkspace((s) => s.select);
    const universeAvailable = webgl && !renderFailed;

    useEffect(() => {
        useWorkspace.getState().reset();
        if (!universeAvailable) useWorkspace.getState().setView('list');
    }, [connection.id, universeAvailable]);

    const load = useCallback(
        async (refresh: boolean) => {
            setLoading(true);
            setError(null);
            try {
                const [schema, layout] = await Promise.all([
                    refresh
                        ? workspaceApi.refresh(connection.id)
                        : workspaceApi.schema(connection.id),
                    workspaceApi.layout(connection.id).catch(() => ({
                        positions: [] as LayoutPositionEntry[],
                    })),
                ]);
                setData(schema);
                setSaved(layout.positions);
            } catch (e) {
                setError(dbErrorFrom(e, 'Could not load the schema.'));
            } finally {
                setLoading(false);
            }
        },
        [connection.id],
    );

    useEffect(() => {
        void load(false);
    }, [load]);

    const persist = useCallback(
        (entries: LayoutPositionEntry[]) => {
            workspaceApi
                .saveLayout(connection.id, entries)
                .catch(() => toast.error('Could not save the layout.'));
        },
        [connection.id],
    );

    const snapshot = data?.snapshot ?? null;
    const { model, status, relayout } = useUniverseModel(
        universeAvailable ? snapshot : null,
        saved,
        persist,
    );
    const selectedTable = useMemo(
        () => snapshot?.tables.find((t) => t.name === selected) ?? null,
        [snapshot, selected],
    );

    const onRenderError = useCallback(() => {
        setRenderFailed(true);
        toast.error(
            'The universe could not be rendered; showing the table list instead.',
        );
    }, []);

    return (
        <div className="flex h-dvh flex-col bg-background text-foreground">
            <Head title={connection.name} />
            <WorkspaceHeader
                connection={connection}
                storedAt={data?.stored_at ?? null}
                loading={loading}
                onRefresh={() => void load(true)}
            />

            {snapshot?.truncated && (
                <div
                    role="status"
                    className="border-b bg-amber-500/10 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-300"
                >
                    Showing {snapshot.tables.length.toLocaleString('en')} of{' '}
                    {(
                        snapshot.total_objects ?? snapshot.tables.length
                    ).toLocaleString('en')}{' '}
                    tables and views (alphabetical). Raise
                    DBSUPERB_SCHEMA_MAX_OBJECTS to include more.
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
                    data-testid="workspace-main"
                    className="relative min-w-0 flex-1"
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
                                                onPositionsChanged={persist}
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

                    {!snapshot && loading && (
                        <div className={centered}>Loading schema…</div>
                    )}
                </main>

                {selectedTable && (
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
