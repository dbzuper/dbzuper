import { useEffect, useState } from 'react';
import { dbErrorFrom, workspaceApi } from '@/lib/workspace-api';
import type { SampleResponse } from '@/types/schema';

export function DataTab({
    connectionId,
    table,
}: {
    connectionId: number;
    table: string;
}) {
    const [data, setData] = useState<SampleResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setData(null);
        setError(null);
        workspaceApi
            .sample(connectionId, table)
            .then((d) => !cancelled && setData(d))
            .catch(
                (e) =>
                    !cancelled &&
                    setError(dbErrorFrom(e, 'Could not load rows.').message),
            );
        return () => {
            cancelled = true;
        };
    }, [connectionId, table]);

    if (error)
        return (
            <p role="alert" className="px-4 py-3 text-xs text-destructive">
                {error}
            </p>
        );
    if (!data)
        return (
            <p className="px-4 py-3 text-xs text-muted-foreground">
                Loading rows…
            </p>
        );
    if (data.rows.length === 0)
        return (
            <p className="px-4 py-3 text-xs text-muted-foreground">No rows.</p>
        );

    return (
        <div>
            <p className="px-4 pt-2 text-[10px] text-muted-foreground">
                First {data.limit} rows (long values truncated)
            </p>
            <div className="overflow-auto">
                <table className="w-max min-w-full font-mono text-[11px]">
                    <thead className="sticky top-0 bg-background">
                        <tr>
                            {data.columns.map((c) => (
                                <th
                                    key={c}
                                    className="px-3 py-1.5 text-left font-medium text-muted-foreground"
                                >
                                    {c}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {data.rows.map((row, r) => (
                            <tr key={r}>
                                {row.map((v, c) => (
                                    <td
                                        key={c}
                                        className="max-w-64 truncate px-3 py-1"
                                    >
                                        {v === null ? (
                                            <span className="text-muted-foreground/70 italic">
                                                NULL
                                            </span>
                                        ) : (
                                            String(v)
                                        )}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
