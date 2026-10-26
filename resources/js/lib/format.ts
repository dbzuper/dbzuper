import type { RowCountSchema } from '@/types/schema';
import type { ConnectionSummary } from '@/types/connection';

const compact = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
});
const full = new Intl.NumberFormat('en');

export function formatRowCount(rc: RowCountSchema): string {
    if (rc.count === null || rc.kind === 'unknown') return '—';
    if (rc.kind === 'estimate') return `~${compact.format(rc.count)}`;
    if (rc.kind === 'at_least') return `${full.format(rc.count)}+`;
    return full.format(rc.count);
}

export function formatBytes(n: number | null): string {
    if (n === null || n < 0) return '—';
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${Number.isInteger(v) ? v : v.toFixed(1)} ${units[i]}`;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/** "5 minutes ago" for the last week, then an absolute UTC timestamp. */
export function formatSnapshotAge(iso: string, now: Date = new Date()): string {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return iso;

    const seconds = Math.round((now.getTime() - at.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600)
        return relative.format(-Math.floor(seconds / 60), 'minute');
    if (seconds < 86_400)
        return relative.format(-Math.floor(seconds / 3600), 'hour');
    if (seconds < 7 * 86_400)
        return relative.format(-Math.floor(seconds / 86_400), 'day');

    return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Where a connection points: `host:port/database`, the file's base name for SQLite, or the database alone. A
 * server-level connection outside any database points at the server: `host:port`.
 */
export function formatConnectionTarget(c: ConnectionSummary): string {
    const database = c.database ?? '';
    if (c.driver === 'sqlite') return database.split(/[\\/]/).pop() || database;
    if (!c.host) return database;
    const server = `${c.host}${c.port ? `:${c.port}` : ''}`;
    return database === '' ? server : `${server}/${database}`;
}
