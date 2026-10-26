import type { ReactNode } from 'react';
import {
    formatBytes,
    formatConnectionTarget,
    formatSnapshotAge,
} from '@/lib/format';
import type { ConnectionSummary } from '@/types/connection';
import type { SchemaSnapshot, ServerInfo } from '@/types/schema';

const plural = (n: number, word: string) =>
    `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;

/** What the status bar's database info panel lists: the server, the open database, and DBZuper's own settings. */
export function DatabaseInfo({
    connection,
    server,
    snapshot,
    storedAt,
}: {
    connection: ConnectionSummary;
    server: ServerInfo | null;
    snapshot: SchemaSnapshot | null;
    storedAt: string | null;
}) {
    const sqlite = connection.driver === 'sqlite';
    const tables = snapshot?.tables.filter((t) => t.kind !== 'view').length;
    const views = snapshot?.tables.filter((t) => t.kind === 'view').length;
    const encoding = [server?.charset, server?.collation]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="grid gap-3 text-xs">
            <Section title={sqlite ? 'Engine' : 'Server'}>
                <Row label="Engine">
                    <span title={server?.version}>
                        {connection.driver_label} {server?.version ?? ''}
                    </span>
                </Row>
                <Row label={sqlite ? 'File' : 'Host'}>
                    {sqlite ? connection.database : serverTarget(connection)}
                </Row>
                {server?.user && <Row label="User">{server.user}</Row>}
                {server && server.ssl !== null && (
                    <Row label="Connection">
                        {server.ssl ? 'Encrypted (TLS)' : 'Not encrypted'}
                    </Row>
                )}
            </Section>
            <Section title="This database">
                {!sqlite && connection.database && (
                    <Row label="Name">{connection.database}</Row>
                )}
                {server?.size_bytes != null && (
                    <Row label="Size">{formatBytes(server.size_bytes)}</Row>
                )}
                {tables !== undefined && (
                    <Row label="Objects">
                        {plural(tables, 'table')}
                        {views ? ` · ${plural(views, 'view')}` : ''}
                    </Row>
                )}
                {encoding && <Row label="Encoding">{encoding}</Row>}
                {server?.timezone && (
                    <Row label="Time zone">{server.timezone}</Row>
                )}
                {!server && (
                    <p className="text-muted-foreground">
                        Refresh the schema to read the server details.
                    </p>
                )}
            </Section>
            <Section title="DBZuper">
                <Row label="Mode">
                    {connection.read_only ? 'Read-only' : 'Read and write'}
                </Row>
                {storedAt && (
                    <Row label="Schema read">{formatSnapshotAge(storedAt)}</Row>
                )}
            </Section>
        </div>
    );
}

/** host:port without the database, which "This database" names. */
function serverTarget(c: ConnectionSummary): string {
    return formatConnectionTarget({ ...c, database: null });
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="grid gap-1">
            <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {title}
            </h3>
            <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
                {children}
            </dl>
        </section>
    );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <>
            <dt className="text-muted-foreground">{label}</dt>
            <dd
                className="truncate font-mono"
                title={typeof children === 'string' ? children : undefined}
            >
                {children}
            </dd>
        </>
    );
}
