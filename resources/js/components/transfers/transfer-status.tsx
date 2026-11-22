import { Download, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useTransferPoll } from '@/hooks/use-transfer-poll';
import { formatBytes } from '@/lib/format';
import { ApiError } from '@/lib/http';
import { ACTIVE_STATUSES, transfersApi } from '@/lib/transfers-api';
import type { Transfer } from '@/lib/transfers-api';
import { cn } from '@/lib/utils';
import type { WorkspaceRef } from '@/types/connection';

export const WAITING_MESSAGE = 'Waiting for a free worker…';
export const NO_WORKER_MESSAGE =
    'No background worker is running. Start one with php artisan queue:work transfers --queue=transfers';

/** How long a job waits (from its creation) before a missing worker is reported. */
export const NO_WORKER_AFTER_MS = 10_000;

const count = (n: number) => n.toLocaleString('en');

/** The message of a failed API call: the server's own when it sent one. */
export function apiMessage(e: unknown, fallback: string): string {
    if (e instanceof ApiError) {
        const body = e.body as { message?: unknown } | null;
        if (body && typeof body.message === 'string' && body.message !== '')
            return body.message;
    }
    return fallback;
}

/**
 * Whether the job has waited at least 10 s, counted from its creation, while the poll reports no worker heartbeat.
 * The heartbeat comes with each poll (worker_alive), so nothing else is fetched.
 */
function useNoWorker(t: Transfer): boolean {
    const pending = t.status === 'pending';
    const [mountedAt] = useState(() => Date.now());
    const [now, setNow] = useState(() => Date.now());
    const created = t.created_at ? Date.parse(t.created_at) : Number.NaN;
    const since = Number.isNaN(created) ? mountedAt : created;
    const remaining = since + NO_WORKER_AFTER_MS - now;

    useEffect(() => {
        if (!pending || remaining <= 0) return;
        const timer = setTimeout(() => setNow(Date.now()), remaining);
        return () => clearTimeout(timer);
    }, [pending, remaining]);

    return pending && remaining <= 0 && t.worker_alive === false;
}

function progressOf(t: Transfer): { text: string; percent: number | null } {
    if (t.rows_done != null && t.rows_total != null && t.rows_total > 0)
        return {
            text: `${count(t.rows_done)} of ${count(t.rows_total)} rows`,
            percent: Math.min(
                100,
                Math.floor((t.rows_done / t.rows_total) * 100),
            ),
        };
    if (t.direction === 'import' && t.statements_done != null) {
        const read =
            t.bytes_total != null && t.bytes_total > 0
                ? ` · ${formatBytes(t.bytes_done)} of ${formatBytes(t.bytes_total)}`
                : '';
        return {
            text: `${count(t.statements_done)} statements${read}`,
            percent:
                t.bytes_total != null && t.bytes_total > 0
                    ? Math.min(
                          100,
                          Math.floor((t.bytes_done / t.bytes_total) * 100),
                      )
                    : null,
        };
    }
    if (t.rows_done != null)
        return { text: `${count(t.rows_done)} rows`, percent: null };
    if (t.bytes_total != null && t.bytes_total > 0)
        return {
            text: `${formatBytes(t.bytes_done)} of ${formatBytes(t.bytes_total)}`,
            percent: Math.min(
                100,
                Math.floor((t.bytes_done / t.bytes_total) * 100),
            ),
        };
    return { text: `${formatBytes(t.bytes_done)} written`, percent: null };
}

/**
 * A started backup or restore: waiting, progress with Cancel, then Download (backups), the failure, or the
 * cancellation. Polls the transfer itself; `transfer` is the row as it was when started.
 */
export function TransferStatus({
    workspace,
    transfer: initial,
    onDone,
}: {
    workspace: WorkspaceRef;
    transfer: Transfer;
    /** Called once when the transfer ends (done, failed or cancelled). */
    onDone?: (t: Transfer) => void;
}) {
    const poll = useTransferPoll(workspace, initial.id);
    const t = poll.transfer ?? initial;
    const noun = t.direction === 'export' ? 'backup' : 'restore';
    const active = ACTIVE_STATUSES.includes(t.status);
    const noWorker = useNoWorker(t);
    const [cancelError, setCancelError] = useState<string | null>(null);
    const [cancelling, setCancelling] = useState(false);

    const reported = useRef(false);
    useEffect(() => {
        const latest = poll.transfer;
        if (!latest || reported.current) return;
        if (ACTIVE_STATUSES.includes(latest.status)) return;
        reported.current = true;
        onDone?.(latest);
    }, [poll.transfer, onDone]);

    const cancel = () => {
        setCancelling(true);
        setCancelError(null);
        transfersApi.cancel(workspace, t.id).catch((e: unknown) => {
            setCancelError(apiMessage(e, `Couldn't cancel the ${noun}.`));
            setCancelling(false);
        });
    };
    const cancelRequested = cancelling || t.cancel_requested_at != null;
    const progress = progressOf(t);

    // Announced when the state changes, not with every progress tick.
    const announcement = {
        uploading: 'Uploading the file.',
        pending: noWorker
            ? 'No background worker is running.'
            : `The ${noun} is waiting for a free worker.`,
        running: `The ${noun} is running.`,
        done: `The ${noun} finished.`,
        // The failure is a role=alert of its own.
        failed: '',
        cancelled: `The ${noun} was cancelled.`,
    }[t.status];

    return (
        <div className="grid gap-3 text-sm">
            <p role="status" className="sr-only">
                {announcement}
            </p>
            {t.status === 'uploading' && (
                <p className="text-muted-foreground">Uploading the file…</p>
            )}
            {t.status === 'pending' && (
                <p className="flex items-start gap-2 text-muted-foreground">
                    {noWorker ? (
                        <TriangleAlert
                            className="mt-0.5 size-4 shrink-0 text-warning"
                            aria-hidden
                        />
                    ) : (
                        <Spinner
                            className="mt-0.5 size-4 shrink-0 motion-reduce:animate-none"
                            aria-hidden
                        />
                    )}
                    <span className={cn(noWorker && 'text-foreground')}>
                        {noWorker ? NO_WORKER_MESSAGE : WAITING_MESSAGE}
                    </span>
                </p>
            )}
            {t.status === 'running' && (
                <div className="grid gap-1.5">
                    <div className="flex min-w-0 items-baseline gap-2">
                        <span className="text-muted-foreground">
                            {t.direction === 'export'
                                ? 'Backing up'
                                : 'Restoring'}
                        </span>
                        {t.current_table && (
                            <span className="truncate font-mono text-[12.5px]">
                                {t.current_table}
                            </span>
                        )}
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                            {progress.text}
                        </span>
                    </div>
                    <div
                        role="progressbar"
                        aria-label={`${noun[0].toUpperCase()}${noun.slice(1)} progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress.percent ?? undefined}
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                    >
                        <div
                            className={cn(
                                'h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none',
                                progress.percent === null &&
                                    'w-1/3 animate-pulse motion-reduce:animate-none',
                            )}
                            style={
                                progress.percent === null
                                    ? undefined
                                    : { width: `${progress.percent}%` }
                            }
                        />
                    </div>
                </div>
            )}
            {active && (
                <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                        {t.status === 'uploading'
                            ? 'Keep this dialog open until the upload finishes.'
                            : `You can close this dialog; the ${noun} keeps running.`}
                    </p>
                    <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        aria-label={`Cancel ${noun}`}
                        disabled={cancelRequested}
                        onClick={cancel}
                    >
                        {cancelRequested ? 'Cancelling…' : 'Cancel'}
                    </Button>
                </div>
            )}
            {t.status === 'done' && (
                <div className="grid gap-2">
                    <p>
                        {t.direction === 'export'
                            ? 'Backup finished.'
                            : `Restore finished${t.statements_done != null ? `: ${count(t.statements_done)} statements` : ''}.`}
                    </p>
                    {t.direction === 'export' && t.downloadable && (
                        <a
                            href={transfersApi.downloadUrl(workspace, t.id)}
                            download={t.file_name ?? true}
                            className={cn(
                                buttonVariants({ size: 'sm' }),
                                'w-fit max-w-full',
                            )}
                        >
                            <Download className="size-3.5" aria-hidden />
                            <span className="truncate">
                                Download {t.file_name}
                            </span>
                            {t.file_size != null && (
                                <span className="opacity-80">
                                    ({formatBytes(t.file_size)})
                                </span>
                            )}
                        </a>
                    )}
                    {t.direction === 'export' && !t.downloadable && (
                        <p className="text-muted-foreground">
                            The file has expired and can no longer be
                            downloaded.
                        </p>
                    )}
                </div>
            )}
            {t.warnings.length > 0 && !active && (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                    <p className="font-medium">Warnings</p>
                    <ul className="mt-1 list-disc pl-4">
                        {t.warnings.map((w) => (
                            <li key={w}>{w}</li>
                        ))}
                    </ul>
                </div>
            )}
            {t.status === 'failed' && (
                <div
                    role="alert"
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
                >
                    <p className="font-medium text-destructive">
                        The {noun} failed.
                    </p>
                    {t.error && (
                        <p className="mt-1 max-h-48 overflow-auto font-mono text-xs break-words whitespace-pre-wrap">
                            {t.error}
                        </p>
                    )}
                </div>
            )}
            {t.status === 'cancelled' && (
                <p className="text-muted-foreground">
                    The {noun} was cancelled.
                </p>
            )}
            {(poll.error ?? cancelError) && (
                <p role="alert" className="text-xs text-destructive">
                    {poll.error ?? cancelError}
                </p>
            )}
        </div>
    );
}
