import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { DbErrorPayload, StatementResultPayload } from '@/types/schema';

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

function RowsTable({ result }: { result: StatementResultPayload }) {
    return (
        <table className="w-max min-w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-muted">
                <tr>
                    {result.columns.map((c, i) => (
                        <th
                            key={i}
                            className="border-b px-2 py-1 text-left font-medium"
                        >
                            {c.name}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {result.rows.map((row, r) => (
                    <tr key={r} className="odd:bg-muted/30">
                        {row.map((cell, c) => (
                            <td
                                key={c}
                                className="max-w-80 truncate border-b px-2 py-0.5 font-mono"
                            >
                                {cell === null ? (
                                    <span className="text-muted-foreground italic">
                                        NULL
                                    </span>
                                ) : (
                                    String(cell)
                                )}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function ResultPanel({
    results,
    error,
    running,
}: {
    results: StatementResultPayload[];
    error: DbErrorPayload | null;
    running: boolean;
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
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
                {current.error ? (
                    <ErrorView error={current.error} />
                ) : current.columns.length > 0 ? (
                    <RowsTable result={current} />
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
}
