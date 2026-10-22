import { Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

type Failure = {
    message: string;
    target: string | null;
    /** The commit got no answer: whether it was applied is unknown. */
    unknown: boolean;
};

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

    /** The statements shown and the exact pending rows they were built from: Commit sends those rows, no others. */
    const [preview, setPreview] = useState<{
        rows: Record<RowRef, PendingRow>;
        statements: PreviewStatement[];
    } | null>(null);
    const statements = preview?.statements ?? null;
    const [failure, setFailure] = useState<Failure | null>(null);
    const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
    /** The changes were staged again while the dialog was open: the preview is being built again. */
    const [again, setAgain] = useState(false);
    const committing = busy === 'commit';
    /** A commit is on its way; a second click must not send it twice. */
    const inFlight = useRef(false);
    /** The open (nonce) and rows the last preview was asked for. */
    const fetched = useRef<{
        nonce: number;
        rows: Record<RowRef, PendingRow>;
    } | null>(null);

    // Everything staged was committed or discarded (another view, another window): nothing left to review.
    useEffect(() => {
        if (open && total === 0 && !committing)
            useReview.getState().closeReview();
    }, [open, total, committing]);

    // A fresh preview on every open, and again whenever the pending changes change while it is open.
    useEffect(() => {
        if (!open || committing || Object.keys(rows).length === 0) return;
        const last = fetched.current;
        if (last && last.nonce === nonce && last.rows === rows) return;
        fetched.current = { nonce, rows };
        let live = true;
        setAgain(last?.nonce === nonce);
        setPreview(null);
        setFailure(null);
        setBusy('preview');
        editingApi
            .preview(connectionId, table, toChanges(rows))
            .then((res) => {
                if (live) setPreview({ rows, statements: res.statements });
            })
            .catch((e: unknown) => {
                if (live) setFailure(fail(e, rows, null, false));
            })
            .finally(() => {
                if (!live) return;
                setBusy(null);
                setAgain(false);
            });
        return () => {
            live = false;
        };
        // `fail` only reads props and the stores.
    }, [open, nonce, rows, committing, connectionId, table]); // eslint-disable-line react-hooks/exhaustive-deps

    /** The failure as the dialog shows it; a change's error also goes on its row in the grid. */
    function fail(
        e: unknown,
        pending: Record<RowRef, PendingRow>,
        shown: PreviewStatement[] | null,
        committed: boolean,
    ): Failure {
        const info =
            e instanceof ChangeSetError ? e.info : changeSetErrorFrom(e);
        // No answer (network, timeout) or a server crash: the transaction may or may not have been applied.
        const unknown =
            committed &&
            (!(e instanceof ChangeSetError) ||
                info.status === null ||
                info.status >= 500);
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
        return { message, target, unknown };
    }

    const current = preview !== null && preview.rows === rows;
    const commit = async () => {
        if (inFlight.current || !preview || preview.rows !== rows) return;
        const { rows: reviewed, statements: shown } = preview;
        const changes = toChanges(reviewed);
        if (changes.length === 0) return;
        inFlight.current = true;
        setBusy('commit');
        setFailure(null);
        try {
            await editingApi.commit(connectionId, table, changes);
        } catch (e) {
            setFailure(fail(e, reviewed, shown, true));
            setBusy(null);
            return;
        } finally {
            inFlight.current = false;
        }
        // Exactly the reviewed changes were applied; anything staged since stays.
        usePending.getState().settle(connectionId, table, reviewed);
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
                        <Spinner className="size-3" />{' '}
                        {again
                            ? 'Changes were updated — reviewing again…'
                            : 'Building the statements…'}
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
                            {failure.unknown
                                ? 'The result is unknown — refresh to check.'
                                : 'Nothing was changed.'}{' '}
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
                        disabled={!current || busy !== null || total === 0}
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
