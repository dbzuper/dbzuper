import { CheckCircle2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatSnapshotAge } from '@/lib/format';
import { historyApi } from '@/lib/history-api';
import type { HistoryEntry, HistoryParams } from '@/lib/history-api';

type StatusFilter = 'all' | 'ok' | 'error';

const selectClass =
    'h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs';

/** First line of the SQL, capped at 160 characters (by code point). */
function preview(sql: string): string {
    const first = sql.trimStart().split('\n')[0];
    const chars = Array.from(first);
    return chars.length > 160 ? `${chars.slice(0, 160).join('')}…` : first;
}

export function HistoryList({
    connectionId,
    connections,
    onOpen,
}: {
    connectionId: number | null;
    connections?: { id: number; name: string }[];
    onOpen: (entry: HistoryEntry) => void;
}) {
    const [search, setSearch] = useState('');
    const [q, setQ] = useState('');
    const [status, setStatus] = useState<StatusFilter>('all');
    const [filterConnection, setFilterConnection] = useState('');
    const [entries, setEntries] = useState<HistoryEntry[]>([]);
    const [next, setNext] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [reload, setReload] = useState(0);
    const controller = useRef<AbortController | null>(null);

    useEffect(() => {
        const id = setTimeout(() => setQ(search.trim()), 250);
        return () => clearTimeout(id);
    }, [search]);

    const params = useCallback(
        (before?: number): HistoryParams => ({
            q: q || undefined,
            status: status === 'all' ? undefined : status,
            before_id: before,
            connection_id:
                connectionId === null && filterConnection
                    ? Number(filterConnection)
                    : undefined,
        }),
        [q, status, filterConnection, connectionId],
    );

    useEffect(() => {
        controller.current?.abort();
        const ctl = new AbortController();
        controller.current = ctl;
        setLoading(true);
        setError(null);
        historyApi
            .list(connectionId, params(), ctl.signal)
            .then((page) => {
                if (ctl.signal.aborted) return;
                setEntries(page.entries);
                setNext(page.next_before_id);
                setLoading(false);
            })
            .catch(() => {
                if (ctl.signal.aborted) return;
                setError('Could not load the history.');
                setLoading(false);
            });
        return () => ctl.abort();
    }, [connectionId, params, reload]);

    const loadMore = () => {
        if (next === null) return;
        controller.current?.abort();
        const ctl = new AbortController();
        controller.current = ctl;
        setLoading(true);
        historyApi
            .list(connectionId, params(next), ctl.signal)
            .then((page) => {
                if (ctl.signal.aborted) return;
                setEntries((prev) => [...prev, ...page.entries]);
                setNext(page.next_before_id);
                setLoading(false);
            })
            .catch(() => {
                if (ctl.signal.aborted) return;
                setError('Could not load more history.');
                setLoading(false);
            });
    };

    const clear = async () => {
        if (connectionId === null) return;
        try {
            await historyApi.clear(connectionId);
            setConfirming(false);
            setReload((n) => n + 1);
        } catch {
            toast.error('Could not clear the history.');
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
                <Input
                    aria-label="Search history"
                    placeholder="Search history"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="min-w-40 flex-1"
                />
                <select
                    aria-label="Status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as StatusFilter)}
                    className={selectClass}
                >
                    <option value="all">All</option>
                    <option value="ok">Succeeded</option>
                    <option value="error">Failed</option>
                </select>
                {connectionId === null && connections && (
                    <select
                        aria-label="Connection"
                        value={filterConnection}
                        onChange={(e) => setFilterConnection(e.target.value)}
                        className={selectClass}
                    >
                        <option value="">All connections</option>
                        {connections.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                )}
                {connectionId !== null &&
                    (confirming ? (
                        <span className="flex items-center gap-1">
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => void clear()}
                            >
                                Confirm clear
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirming(false)}
                            >
                                Cancel
                            </Button>
                        </span>
                    ) : (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirming(true)}
                        >
                            Clear history
                        </Button>
                    ))}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                {error && (
                    <p role="alert" className="p-3 text-sm text-destructive">
                        {error}
                    </p>
                )}
                {!error && !loading && entries.length === 0 && (
                    <p className="p-3 text-sm text-muted-foreground">
                        No history yet.
                    </p>
                )}
                <ul className="divide-y">
                    {entries.map((e) => (
                        <li
                            key={e.id}
                            className="flex items-start gap-2 px-3 py-2"
                        >
                            {e.status === 'ok' ? (
                                <CheckCircle2
                                    role="img"
                                    aria-label="Succeeded"
                                    className="mt-0.5 size-4 shrink-0 text-emerald-600"
                                />
                            ) : (
                                <XCircle
                                    role="img"
                                    aria-label="Failed"
                                    className="mt-0.5 size-4 shrink-0 text-destructive"
                                />
                            )}
                            <div className="min-w-0 flex-1">
                                <code className="block truncate font-mono text-xs">
                                    {preview(e.sql)}
                                </code>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    {e.connection && (
                                        <span className="mr-2 font-medium">
                                            {e.connection.name}
                                        </span>
                                    )}
                                    {formatSnapshotAge(e.created_at)} ·{' '}
                                    {e.duration_ms} ms
                                    {e.row_count !== null &&
                                        ` · ${e.row_count.toLocaleString('en')} rows`}
                                    {e.affected !== null &&
                                        ` · ${e.affected.toLocaleString('en')} affected`}
                                </p>
                                {e.error && (
                                    <p className="mt-0.5 truncate text-xs text-destructive">
                                        {e.error}
                                    </p>
                                )}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onOpen(e)}
                            >
                                Open
                            </Button>
                        </li>
                    ))}
                </ul>
                {next !== null && (
                    <div className="p-3">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            onClick={loadMore}
                        >
                            Load more
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
