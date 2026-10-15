import { Check, Copy, TerminalSquare, X } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useClipboard } from '@/hooks/use-clipboard';
import { useSqlTabs } from '@/sql/tabs-store';
import type { Dialect, SchemaSnapshot } from '@/types/schema';
import { buildJoinSql } from '@/universe/path';
import { useWorkspace } from '@/universe/store';

export function PathDialog({
    snapshot,
    connectionId,
}: {
    snapshot: SchemaSnapshot;
    connectionId: number;
}) {
    const pathFrom = useWorkspace((s) => s.pathFrom);
    const pathTo = useWorkspace((s) => s.pathTo);
    const path = useWorkspace((s) => s.path);
    const showInferred = useWorkspace((s) => s.showInferred);
    const clearPath = useWorkspace((s) => s.clearPath);
    const [copiedText, copy] = useClipboard();
    const sql = useMemo(
        () =>
            path && path.length > 1
                ? buildJoinSql(
                      snapshot,
                      path,
                      snapshot.driver as Dialect,
                      showInferred,
                  )
                : null,
        [snapshot, path, showInferred],
    );
    if (path === null) return null;

    const copied = sql !== null && copiedText === sql;
    let message: string;
    if (path.length === 0)
        message = `No relationship path connects ${pathFrom} and ${pathTo}.`;
    else if (path.length === 1)
        message = 'Pick a different table to find a path.';
    else message = path.join(' → ');

    return (
        <section
            role="dialog"
            aria-label="Path finder"
            aria-modal="false"
            className="absolute right-4 bottom-4 z-20 grid w-[28rem] max-w-[calc(100%-2rem)] gap-3 rounded-lg border bg-popover/95 p-4 shadow-lg backdrop-blur"
        >
            <header className="flex items-start gap-2">
                <div className="grid gap-1">
                    <h2 className="text-sm font-semibold">Path finder</h2>
                    <p className="text-sm text-muted-foreground">{message}</p>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-6"
                    aria-label="Close path finder"
                    onClick={() => clearPath()}
                >
                    <X className="size-4" />
                </Button>
            </header>
            {path.length > 1 && sql === null && (
                <p className="text-sm">
                    This path uses inferred relationships, which are hidden.
                    Show inferred relationships to use it.
                </p>
            )}
            {sql && (
                <>
                    <pre
                        data-testid="join-sql"
                        tabIndex={0}
                        aria-label="Generated JOIN SQL"
                        className="overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre"
                    >
                        {sql}
                    </pre>
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            className="ml-auto"
                            onClick={() => {
                                useSqlTabs
                                    .getState()
                                    .openTab(connectionId, sql, 'Path');
                                useWorkspace.getState().setDockOpen(true);
                            }}
                        >
                            <TerminalSquare className="size-3.5" />
                            Open in SQL
                        </Button>
                        <Button size="sm" onClick={() => void copy(sql)}>
                            <span
                                aria-live="polite"
                                className="inline-flex items-center gap-1.5"
                            >
                                {copied ? (
                                    <Check className="size-3.5" />
                                ) : (
                                    <Copy className="size-3.5" />
                                )}
                                {copied ? 'Copied' : 'Copy SQL'}
                            </span>
                        </Button>
                    </div>
                </>
            )}
        </section>
    );
}
