import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import {
    ChangeSetError,
    changeSetErrorFrom,
    editingApi,
    type ChangeSetErrorInfo,
    type PreviewStatement,
} from '@/editing/editing-api';
import {
    changeRefs,
    pendingKey,
    toChanges,
    usePending,
    type PendingRow,
    type RowRef,
} from '@/editing/pending-store';
import { useReview } from '@/editing/review-store';
import { writeClipboard } from '@/grid/copy';
import { cn } from '@/lib/utils';

const NO_ROWS: Record<RowRef, PendingRow> = {};

export const TRANSACTION_NOTE =
    'Runs as one transaction: all of them succeed, or nothing changes.';

const plural = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

/**
 * The message for a failed change. A new row whose INSERT affected no row comes back as a row mismatch ("row
 * changed since you loaded it"), which means nothing for a row that was never loaded.
 */
export function changeErrorMessage(
    info: ChangeSetErrorInfo,
    op: PendingRow['kind'] | undefined,
): string {
    if (op === 'insert' && info.kind === 'row_mismatch')
        return 'the new row could not be added';
    return info.message;
}

type Failure = { message: string; target: string | null };

const OP_LABEL: Record<PreviewStatement['op'], string> = {
    insert: 'Insert',
    update: 'Update',
    delete: 'Delete',
};

/**
 * Review & commit (spec §4.3): the statements the server will run, with values inlined, in execution order. Commit
 * runs them in one transaction; a failure leaves every change staged and outlines the failing row in the grid.
 */
export function ReviewDialog({
    connectionId,
    table,
    onCommitted,
}: {
    connectionId: number;
    table: string;
    /** After a successful commit, once the pending changes are cleared: refetch the rows. */
    onCommitted: () => void;
}) {
    const open = useReview(
        (s) =>
            s.open !== null &&
            s.open.connectionId === connectionId &&
            s.open.table === table,
    );
    const nonce = useReview((s) => s.nonce);
    const rows =
        usePending((s) => s.byTable[pendingKey(connectionId, table)]) ??
        NO_ROWS;
    const total = Object.keys(rows).length;

    const [statements, setStatements] = useState<PreviewStatement[] | null>(
        null,
    );
    const [failure, setFailure] = useState<Failure | null>(null);
    const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);

    // Everything staged was committed or discarded (another view, another window): nothing left to review.
    useEffect(() => {
        if (open && total === 0 && busy !== 'commit')
            useReview.getState().closeReview();
    }, [open, total, busy]);

    // A fresh preview on every open: the pending changes may have changed since the last one.
    useEffect(() => {
        if (!open) return;
        const pending =
            usePending.getState().byTable[pendingKey(connectionId, table)] ??
            NO_ROWS;
        if (Object.keys(pending).length === 0) return;
        let live = true;
        setStatements(null);
        setFailure(null);
        setBusy('preview');
        editingApi
            .preview(connectionId, table, toChanges(pending))
            .then((res) => {
                if (live) setStatements(res.statements);
            })
            .catch((e: unknown) => {
                if (live) setFailure(fail(e, pending, null));
            })
            .finally(() => {
                if (live) setBusy(null);
            });
        return () => {
            live = false;
        };
        // `nonce` makes a re-open of the same table fetch again.
    }, [open, nonce, connectionId, table]); // eslint-disable-line react-hooks/exhaustive-deps

    /** The failure as the dialog shows it; a change's error also goes on its row in the grid. */
    function fail(
        e: unknown,
        pending: Record<RowRef, PendingRow>,
        shown: PreviewStatement[] | null,
    ): Failure {
        const info =
            e instanceof ChangeSetError ? e.info : changeSetErrorFrom(e);
        const ref =
            info.index === null ? undefined : changeRefs(pending)[info.index];
        const row = ref ? pending[ref] : undefined;
        const message = changeErrorMessage(info, row?.kind);
        usePending
            .getState()
            .setErrors(
                connectionId,
                table,
                ref && row ? { [ref]: message } : {},
            );
        const target =
            info.index === null
                ? null
                : (shown?.find((s) => s.index === info.index)?.target ?? null);
        return { message, target };
    }

    const commit = async () => {
        const pending =
            usePending.getState().byTable[pendingKey(connectionId, table)] ??
            NO_ROWS;
        const changes = toChanges(pending);
        if (changes.length === 0) return;
        setBusy('commit');
        setFailure(null);
        try {
            await editingApi.commit(connectionId, table, changes);
        } catch (e) {
            setFailure(fail(e, pending, statements));
            setBusy(null);
            return;
        }
        const store = usePending.getState();
        store.discard(connectionId, table);
        store.setErrors(connectionId, table, {});
        setBusy(null);
        useReview.getState().closeReview();
        onCommitted();
        toast.success(`${plural(changes.length)} committed`);
    };

    const copy = async () => {
        if (!statements) return;
        const sql = statements.map((s) => `${s.sql};`).join('\n');
        if (await writeClipboard(sql)) toast.success('Copied SQL');
        else toast.error('Could not copy');
    };

    const committing = busy === 'commit';
    const close = () => {
        if (!committing) useReview.getState().closeReview();
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) close();
            }}
        >
            <DialogContent
                className="sm:max-w-3xl"
                onEscapeKeyDown={(e) => {
                    if (committing) e.preventDefault();
                }}
                onPointerDownOutside={(e) => {
                    if (committing) e.preventDefault();
                }}
            >
                <DialogHeader>
                    <DialogTitle>
                        Review {plural(total)} to{' '}
                        <span className="font-mono">{table}</span>
                    </DialogTitle>
                    <DialogDescription>{TRANSACTION_NOTE}</DialogDescription>
                </DialogHeader>
                {busy === 'preview' && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Spinner className="size-3" /> Building the statements…
                    </p>
                )}
                {statements && (
                    <ol className="grid max-h-[50vh] gap-2 overflow-y-auto">
                        {statements.map((s) => (
                            <li
                                key={`${s.index}:${s.op}`}
                                className="grid gap-1 rounded-md border p-2"
                            >
                                <div className="flex items-center gap-2 text-xs">
                                    <span
                                        className={cn(
                                            'rounded px-1.5 py-0.5 font-medium',
                                            s.op === 'insert' &&
                                                'bg-success/15 text-success',
                                            s.op === 'update' &&
                                                'bg-warning/20 text-warning-foreground',
                                            s.op === 'delete' &&
                                                'bg-destructive/10 text-destructive',
                                        )}
                                    >
                                        {OP_LABEL[s.op]}
                                    </span>
                                    <span className="text-muted-foreground">
                                        {s.target}
                                    </span>
                                </div>
                                <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
                                    {s.sql}
                                </pre>
                            </li>
                        ))}
                    </ol>
                )}
                {failure && (
                    <div
                        role="alert"
                        className="rounded-md border border-destructive/40 px-3 py-2 text-xs"
                    >
                        <p className="font-medium text-destructive">
                            Nothing was changed.{' '}
                            {failure.target && (
                                <span>Row {failure.target}: </span>
                            )}
                            {failure.message}
                        </p>
                    </div>
                )}
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={committing}
                        onClick={close}
                    >
                        Back
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!statements || committing}
                        onClick={() => void copy()}
                    >
                        <Copy className="size-3.5" /> Copy SQL
                    </Button>
                    <Button
                        type="button"
                        disabled={!statements || busy !== null || total === 0}
                        onClick={() => void commit()}
                    >
                        {committing ? (
                            <>
                                <Spinner className="size-3" /> Committing…
                            </>
                        ) : (
                            `Commit ${plural(total)}`
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
