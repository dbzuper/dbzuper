import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatBytes } from '@/lib/format';
import { ACTIVE_STATUSES, transfersApi } from '@/lib/transfers-api';
import type { Transfer, TransferStatus } from '@/lib/transfers-api';
import type { WorkspaceRef } from '@/types/connection';

/** While a listed transfer is still active, the list is read again this often. */
export const RECENT_REFRESH_MS = 5000;

const STATUS_LABEL: Record<TransferStatus, string> = {
    uploading: 'Uploading',
    pending: 'Waiting',
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled',
};

const when = (iso: string | null) => {
    if (!iso) return '';
    const at = new Date(iso);
    return Number.isNaN(at.getTime())
        ? ''
        : at.toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
          });
};

/**
 * This user's recent backups and restores on this database, so a backup started before the dialog was closed can
 * still be downloaded while its file is kept.
 */
export function RecentTransfers({
    workspace,
    refreshKey = 0,
    exclude,
    direction,
    onShow,
}: {
    workspace: WorkspaceRef;
    /** Changing it reads the list again (e.g. after a transfer ends). */
    refreshKey?: number;
    /** A transfer already shown elsewhere in the dialog. */
    exclude?: string | null;
    /** Only backups ('export') or only restores ('import'); both when left out. */
    direction?: Transfer['direction'];
    /** Shows a still-running transfer's progress. */
    onShow?: (t: Transfer) => void;
}) {
    const [transfers, setTransfers] = useState<Transfer[] | null>(null);

    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const load = () =>
            transfersApi
                .list(workspace)
                .then(({ transfers: list }) => {
                    if (stopped) return;
                    setTransfers(list);
                    if (list.some((t) => ACTIVE_STATUSES.includes(t.status)))
                        timer = setTimeout(load, RECENT_REFRESH_MS);
                })
                .catch(() => {
                    // The list is a convenience: without it the dialog still works.
                });
        void load();
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [workspace, refreshKey]);

    const shown = (transfers ?? []).filter(
        (t) =>
            t.id !== exclude &&
            (direction === undefined || t.direction === direction),
    );
    if (shown.length === 0) return null;

    return (
        <section aria-labelledby="recent-transfers" className="grid gap-1.5">
            <h3
                id="recent-transfers"
                className="text-xs font-medium text-muted-foreground"
            >
                Recent
            </h3>
            <ul className="grid max-h-40 gap-0.5 overflow-auto rounded-md border p-1 text-xs">
                {shown.map((t) => {
                    const active = ACTIVE_STATUSES.includes(t.status);
                    const name =
                        t.file_name ??
                        (t.direction === 'export' ? 'Backup' : 'Restore');
                    return (
                        <li
                            key={t.id}
                            className="flex min-w-0 items-center gap-2 rounded px-2 py-1 hover:bg-muted/50"
                        >
                            <span className="w-14 shrink-0 text-muted-foreground">
                                {t.direction === 'export'
                                    ? 'Backup'
                                    : 'Restore'}
                            </span>
                            {t.direction === 'export' && t.downloadable ? (
                                <a
                                    href={transfersApi.downloadUrl(
                                        workspace,
                                        t.id,
                                    )}
                                    download={t.file_name ?? true}
                                    className="inline-flex min-w-0 items-center gap-1 font-mono text-[11.5px] text-foreground underline-offset-2 hover:underline focus-visible:underline"
                                >
                                    <Download
                                        className="size-3 shrink-0 text-muted-foreground"
                                        aria-hidden
                                    />
                                    <span className="truncate">{name}</span>{' '}
                                    <span className="sr-only">(download)</span>
                                </a>
                            ) : (
                                <span className="truncate font-mono text-[11.5px]">
                                    {name}
                                </span>
                            )}
                            <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                                {t.file_size !== null &&
                                    `${formatBytes(t.file_size)} · `}
                                {STATUS_LABEL[t.status]}
                                {when(t.created_at) &&
                                    ` · ${when(t.created_at)}`}
                            </span>
                            {active && onShow && (
                                <button
                                    type="button"
                                    onClick={() => onShow(t)}
                                    aria-label={`Show the progress of ${name}`}
                                    className="shrink-0 rounded px-1 text-foreground underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                >
                                    Show
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
