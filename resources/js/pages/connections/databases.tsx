import { Head, Link } from '@inertiajs/react';
import { ArrowLeft, Database, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { safeStorage } from '@/browse/safe-storage';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { workspaceUrl } from '@/lib/connections';
import {
    databasesApi,
    readShowSystem,
    visibleDatabases,
    writeShowSystem,
    type DatabaseEntry,
    type DatabaseList,
} from '@/lib/databases-api';
import { formatBytes, formatConnectionTarget } from '@/lib/format';
import { prefetchWorkspace } from '@/lib/prefetch-workspace';
import { dbErrorFrom } from '@/lib/workspace-api';
import { cn } from '@/lib/utils';
import type { ConnectionSummary } from '@/types/connection';
import type { DbErrorPayload } from '@/types/schema';

const UNOPENABLE =
    "This name can't be used in a connection, so DBZuper can't open it.";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The databases of a server-level connection; picking one opens its workspace. */
export default function Databases({
    connection,
}: {
    connection: ConnectionSummary;
}) {
    const [list, setList] = useState<DatabaseList | null>(null);
    const [error, setError] = useState<DbErrorPayload | null>(null);
    const [query, setQuery] = useState('');
    const [showSystem, setShowSystem] = useState(() =>
        readShowSystem(safeStorage),
    );

    const load = useCallback(() => {
        setError(null);
        setList(null);
        databasesApi
            .list(connection.id)
            .then(setList)
            .catch((e) =>
                setError(dbErrorFrom(e, 'Could not list the databases.')),
            );
    }, [connection.id]);

    useEffect(load, [load]);

    const toggleSystem = (show: boolean) => {
        setShowSystem(show);
        writeShowSystem(safeStorage, show);
    };

    const shown = list ? visibleDatabases(list, showSystem, query) : [];

    return (
        <>
            <Head title={connection.name} />
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8 sm:px-10">
                <Link
                    href="/connections"
                    className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="size-4" aria-hidden /> Connections
                </Link>
                <header className="flex flex-col gap-1">
                    <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                        <span
                            aria-hidden
                            className="size-2.5 shrink-0 rounded-full"
                            style={{
                                background:
                                    connection.color ??
                                    'var(--universe-accent)',
                            }}
                        />
                        {connection.name}
                        <span className="font-mono text-xs font-normal text-muted-foreground">
                            {connection.driver_label}
                        </span>
                    </h1>
                    <p className="font-mono text-xs text-muted-foreground">
                        {formatConnectionTarget(connection)}
                        {connection.username ? ` · ${connection.username}` : ''}
                    </p>
                </header>

                <div className="flex flex-wrap items-center gap-3">
                    <label className="flex h-9 min-w-48 flex-1 items-center gap-2 rounded-[10px] border bg-background px-3 text-muted-foreground focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                        <Search className="size-4 shrink-0" aria-hidden />
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') setQuery('');
                            }}
                            placeholder="Find a database"
                            aria-label="Find a database"
                            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
                        />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                            type="checkbox"
                            checked={showSystem}
                            onChange={(e) => toggleSystem(e.target.checked)}
                        />
                        Show system databases
                    </label>
                </div>

                {error ? (
                    <div
                        role="alert"
                        className="flex flex-col items-start gap-3 rounded-[14px] border border-destructive/40 p-4 text-sm"
                    >
                        <p className="font-medium">
                            Could not list the databases on this server.
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">
                            {error.message}
                        </p>
                        <Button variant="outline" size="sm" onClick={load}>
                            Retry
                        </Button>
                    </div>
                ) : list === null ? (
                    <div
                        className="flex flex-col gap-2"
                        aria-busy="true"
                        aria-label="Loading databases"
                    >
                        {[0, 1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-12 rounded-[10px]" />
                        ))}
                    </div>
                ) : shown.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                        {query.trim()
                            ? `No database matches "${query.trim()}"`
                            : 'This login can see no databases on the server.'}
                    </p>
                ) : (
                    <ul
                        aria-label="Databases"
                        className="divide-y rounded-[14px] border bg-card"
                    >
                        {shown.map((d) => (
                            <DatabaseRow
                                key={d.name}
                                connectionId={connection.id}
                                database={d}
                                last={d.name === list.last_database}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </>
    );
}

function DatabaseRow({
    connectionId,
    database: d,
    last,
}: {
    connectionId: number;
    database: DatabaseEntry;
    last: boolean;
}) {
    const details = (
        <>
            <Database
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
            />
            <span className="min-w-0 flex-1 truncate font-mono text-sm">
                {d.name}
            </span>
            {last && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                    Last opened
                </span>
            )}
            {d.system && (
                <span className="text-[11px] text-muted-foreground">
                    system
                </span>
            )}
            <span className="w-24 text-right text-xs text-muted-foreground tabular-nums">
                {d.tables === null ? '—' : plural(d.tables, 'table')}
            </span>
            <span className="w-20 text-right text-xs text-muted-foreground tabular-nums">
                {formatBytes(d.bytes)}
            </span>
        </>
    );
    const row =
        'flex items-center gap-3 px-4 py-3 first:rounded-t-[13px] last:rounded-b-[13px]';

    return (
        <li>
            {d.openable ? (
                <Link
                    href={workspaceUrl(connectionId, d.name)}
                    onMouseEnter={prefetchWorkspace}
                    onFocus={prefetchWorkspace}
                    className={cn(
                        row,
                        'transition-colors outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    )}
                >
                    {details}
                </Link>
            ) : (
                <div
                    className={cn(row, 'opacity-55')}
                    aria-disabled="true"
                    title={UNOPENABLE}
                >
                    {details}
                    <span className="sr-only">{UNOPENABLE}</span>
                </div>
            )}
        </li>
    );
}

Databases.layout = {
    breadcrumbs: [{ title: 'Connections', href: '/connections' }],
};
