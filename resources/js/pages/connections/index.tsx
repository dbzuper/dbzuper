import { Button } from '@/components/ui/button';
import AppLayout from '@/layouts/app-layout';
import type { ConnectionSummary } from '@/types/connection';
import { Head, Link, router } from '@inertiajs/react';

export default function ConnectionsIndex({ connections }: { connections: ConnectionSummary[] }) {
    const remove = (c: ConnectionSummary) => {
        if (window.confirm(`Remove the saved connection "${c.name}"? The database itself is not affected.`)) {
            router.delete(`/connections/${c.id}`);
        }
    };

    return (
        <AppLayout breadcrumbs={[{ title: 'Connections', href: '/connections' }]}>
            <Head title="Connections" />
            <div className="p-6">
                <div className="mb-6 flex items-center justify-between">
                    <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
                    <Button asChild><Link href="/connections/create">New connection</Link></Button>
                </div>

                {connections.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No connections yet. Add one to start exploring.</p>
                ) : (
                    <ul className="divide-y divide-border rounded-lg border">
                        {connections.map((c) => (
                            <li key={c.id} className="flex items-center gap-4 px-4 py-3">
                                <span className="size-2.5 rounded-full" style={{ background: c.color ?? 'var(--color-teal-500)' }} aria-hidden />
                                <Link href={`/c/${c.id}`} className="min-w-0 flex-1">
                                    <div className="truncate font-medium">{c.name}</div>
                                    <div className="truncate font-mono text-xs text-muted-foreground">
                                        {c.driver_label} · {c.host ? `${c.host}:${c.port}/` : ''}{c.database}
                                    </div>
                                </Link>
                                {c.read_only && <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">read-only</span>}
                                <Button variant="ghost" size="sm" asChild><Link href={`/connections/${c.id}/edit`}>Edit</Link></Button>
                                <Button variant="ghost" size="sm" onClick={() => remove(c)}>Remove</Button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </AppLayout>
    );
}
