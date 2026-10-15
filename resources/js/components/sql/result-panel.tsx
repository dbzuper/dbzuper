import { memo, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ResultGrid } from '@/components/grid/result-grid';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toCSV, toJSON, toTSV, writeClipboard } from '@/grid/copy';
import { cn } from '@/lib/utils';
import type {
    DbErrorPayload,
    SchemaSnapshot,
    StatementResultPayload,
} from '@/types/schema';
import { useWorkspace } from '@/universe/store';

const keywordOf = (sql: string) =>
    (sql.trim().match(/^[A-Za-z]+/)?.[0] ?? 'SQL').toUpperCase();

function positionText(position: { line: number; column: number | null }) {
    return `line ${position.line}${position.column ? `, column ${position.column}` : ''}`;
}

function ErrorView({
    error,
}: {
    error: DbErrorPayload & {
        position?: { line: number; column: number | null };
    };
}) {
    return (
        <div role="alert" className="p-3 text-sm text-destructive">
            <p className="font-medium">{error.message}</p>
            {error.position && (
                <p className="mt-1 text-xs">{positionText(error.position)}</p>
            )}
        </div>
    );
}

const openForeign = (table: string, column: string, value: string) =>
    useWorkspace.getState().openDataFilter(table, column, value);

const FORMATS = [
    { label: 'TSV', run: toTSV },
    { label: 'CSV', run: toCSV },
    { label: 'JSON', run: toJSON },
] as const;

function ResultActions({ result }: { result: StatementResultPayload }) {
    const copyAs = async (format: (typeof FORMATS)[number]) => {
        const ok = await writeClipboard(
            format.run(result.columns, result.rows),
        );
        if (ok) toast.success(`Copied ${format.label}.`);
        else toast.error('Could not copy: the clipboard is unavailable.');
    };
    const download = () => {
        const url = URL.createObjectURL(
            new Blob([toCSV(result.columns, result.rows)], {
                type: 'text/csv;charset=utf-8',
            }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = 'result.csv';
        link.click();
        URL.revokeObjectURL(url);
    };
    return (
        <div className="ml-auto flex shrink-0 items-center gap-1">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="sm">
                        Copy as
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {FORMATS.map((f) => (
                        <DropdownMenuItem
                            key={f.label}
                            onSelect={() => void copyAs(f)}
                        >
                            {f.label}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" variant="ghost" size="sm" onClick={download}>
                Download CSV
            </Button>
        </div>
    );
}

export const ResultPanel = memo(function ResultPanel({
    results,
    error,
    running,
    snapshot = null,
}: {
    results: StatementResultPayload[];
    error: DbErrorPayload | null;
    running: boolean;
    snapshot?: SchemaSnapshot | null;
}) {
    const [index, setIndex] = useState(0);
    useEffect(() => setIndex(0), [results]);

    if (error) return <ErrorView error={error} />;
    if (results.length === 0)
        return (
            <p className="p-3 text-xs text-muted-foreground">
                {running
                    ? 'Running…'
                    : 'Run a statement to see its results here.'}
            </p>
        );

    const current = results[Math.min(index, results.length - 1)];
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div
                role="tablist"
                aria-label="Statement results"
                className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2"
            >
                {results.map((r, i) => (
                    <button
                        key={i}
                        type="button"
                        role="tab"
                        aria-selected={r === current}
                        className={cn(
                            'rounded-md px-2 py-1 text-xs',
                            r.error
                                ? 'text-destructive'
                                : 'text-muted-foreground',
                            r === current && 'bg-muted font-medium',
                            r === current && !r.error && 'text-foreground',
                        )}
                        onClick={() => setIndex(i)}
                    >
                        #{i + 1} {keywordOf(r.sql)}
                    </button>
                ))}
                {!current.error && current.columns.length > 0 && (
                    <ResultActions result={current} />
                )}
            </div>
            <div className="min-h-0 flex-1">
                {current.error ? (
                    <ErrorView error={current.error} />
                ) : current.columns.length > 0 ? (
                    <ResultGrid
                        columns={current.columns}
                        rows={current.rows}
                        snapshot={snapshot}
                        onOpenForeign={openForeign}
                    />
                ) : (
                    <p className="p-3 text-sm">
                        {current.affected ?? 0} rows affected ·{' '}
                        {current.duration_ms} ms
                    </p>
                )}
            </div>
            {current.truncated && (
                <div className="shrink-0 border-t bg-muted px-3 py-1 text-xs text-muted-foreground">
                    Showing first {current.rows.length.toLocaleString('en-US')}{' '}
                    rows (limit reached)
                </div>
            )}
        </div>
    );
});
