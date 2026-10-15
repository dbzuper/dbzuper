import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { registerSqlCompletion } from '@/sql/monaco-completion';
import { useSqlTabs } from '@/sql/tabs-store';
import type { ConnectionSummary } from '@/types/connection';
import type { Dialect, SchemaSnapshot } from '@/types/schema';
import { useWorkspace } from '@/universe/store';
import { SqlEditor } from './sql-editor';
import { SqlTabsBar } from './sql-tabs-bar';

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
            <div className="min-h-0 flex-1">
                {active && (
                    <SqlEditor
                        path={active.id}
                        value={active.sql}
                        dialect={snapshot.driver}
                        onChange={(sql) =>
                            setSql(connection.id, active.id, sql)
                        }
                        onMount={(_editor, monaco) =>
                            registerSqlCompletion(monaco, () => ({
                                snapshot: context.current.snapshot,
                                dialect: context.current.snapshot
                                    .driver as Dialect,
                                focusedTable: useWorkspace.getState().selected,
                            }))
                        }
                    />
                )}
            </div>
        </section>
    );
}
