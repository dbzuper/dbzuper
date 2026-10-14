import { TableList } from '@/components/workspace/table-list';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AppLayout from '@/layouts/app-layout';
import { ApiError, apiFetch } from '@/lib/http';
import type { ConnectionSummary } from '@/types/connection';
import type { DbErrorPayload, SchemaResponse } from '@/types/schema';
import { Head } from '@inertiajs/react';
import { useCallback, useEffect, useState } from 'react';

export default function WorkspaceShow({ connection }: { connection: ConnectionSummary }) {
    const [data, setData] = useState<SchemaResponse | null>(null);
    const [error, setError] = useState<DbErrorPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');

    const load = useCallback(async (refresh: boolean) => {
        setLoading(true);
        setError(null);
        try {
            const url = `/api/c/${connection.id}/schema${refresh ? '/refresh' : ''}`;
            setData(await apiFetch<SchemaResponse>(url, { method: refresh ? 'POST' : 'GET' }));
        } catch (e) {
            const body = e instanceof ApiError ? (e.body as { error?: DbErrorPayload }) : null;
            setError(body?.error ?? { kind: 'unknown', message: 'Could not load the schema.', sqlstate: null, reason: null });
        } finally {
            setLoading(false);
        }
    }, [connection.id]);

    useEffect(() => {
        void load(false);
    }, [load]);

    const snapshot = data?.snapshot;
    const inferred = snapshot?.relationships.filter((r) => r.inferred).length ?? 0;

    return (
        <AppLayout breadcrumbs={[{ title: 'Connections', href: '/connections' }, { title: connection.name, href: `/c/${connection.id}` }]}>
            <Head title={connection.name} />
            <div className="flex flex-col gap-4 p-6">
                <header className="flex flex-wrap items-center gap-3">
                    <h1 className="text-xl font-semibold tracking-tight">{connection.name}</h1>
                    <span className="rounded border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{connection.driver_label}</span>
                    {connection.read_only && <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">read-only</span>}
                    <div className="ml-auto flex items-center gap-2">
                        <Input placeholder="Filter tables" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56" />
                        <Button variant="outline" onClick={() => load(true)} disabled={loading}>{loading ? 'Loading…' : 'Refresh schema'}</Button>
                    </div>
                </header>

                {error && (
                    <div role="alert" className="rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                        {error.message}
                    </div>
                )}

                {snapshot && (
                    <>
                        <p className="text-sm text-muted-foreground">
                            {snapshot.tables.length} tables and views · {snapshot.relationships.length} relationships ({inferred} inferred)
                        </p>
                        <div className="rounded-lg border">
                            <TableList snapshot={snapshot} filter={filter} />
                        </div>
                    </>
                )}
            </div>
        </AppLayout>
    );
}
