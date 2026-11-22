import { TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { UploadError, uploadInChunks } from '@/lib/chunked-upload';
import { readHead, sniffDumpEngine } from '@/lib/dump-sniff';
import type { DumpEngine } from '@/lib/dump-sniff';
import { formatBytes, shortVersion } from '@/lib/format';
import { ACTIVE_STATUSES, transfersApi } from '@/lib/transfers-api';
import type { Transfer, TransferCapabilities } from '@/lib/transfers-api';
import type { ConnectionSummary, WorkspaceRef } from '@/types/connection';
import { MethodChoice, Row, useMethod } from './form-parts';
import { RecentTransfers } from './recent-transfers';
import { TransferStatus, apiMessage } from './transfer-status';

export const ACCEPTED_FILES = '.sql,.gz,.sql.gz';
export const UPLOAD_NOTE = 'Closing stops the upload.';
export const UPLOAD_SENT_NOTE =
    'The file is uploaded; the restore starts next.';

const ENGINE_LABEL: Record<DumpEngine, string> = {
    mysql: 'MySQL',
    mariadb: 'MariaDB',
    pgsql: 'PostgreSQL',
    sqlite: 'SQLite',
};

/** MySQL and MariaDB dumps restore into each other: a mismatch is only across families. */
const family = (engine: DumpEngine) =>
    engine === 'mariadb' ? 'mysql' : engine;

type Props = {
    connection: ConnectionSummary;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The server version from the schema snapshot, for the title. */
    serverVersion?: string | null;
};

/**
 * Restore an SQL file into the open database (spec §3): the file, the method, then a typed confirmation, the upload
 * and the restore's progress. Never shown for a read-only connection.
 */
export function RestoreDialog(props: Props) {
    const { connection, open, onOpenChange } = props;
    const readOnly = connection.read_only;

    useEffect(() => {
        if (open && readOnly) onOpenChange(false);
    }, [open, readOnly, onOpenChange]);

    if (readOnly) return null;
    // A new connection starts from a fresh form; unmounting the old one stops its upload.
    return <RestoreForm key={connection.ref} {...props} />;
}

type Upload = {
    controller: AbortController;
    workspace: WorkspaceRef;
    id: string;
};

function RestoreForm({
    connection,
    open,
    onOpenChange,
    serverVersion = null,
}: Props) {
    const workspace = connection.ref;
    const [caps, setCaps] = useState<TransferCapabilities | null>(null);
    const [capsError, setCapsError] = useState<string | null>(null);

    const [file, setFile] = useState<File | null>(null);
    const [sniffed, setSniffed] = useState<DumpEngine | null>(null);
    const [confirm, setConfirm] = useState('');

    const [active, setActive] = useState<Transfer | null>(null);
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);
    const [finished, setFinished] = useState(false);
    const [recentKey, setRecentKey] = useState(0);

    /** This page's upload: sending, stopped by Cancel or closing (until the poll shows the end), or sent. */
    const [uploadPhase, setUploadPhase] = useState<
        'sending' | 'stopping' | 'sent' | null
    >(null);
    /** Bytes sent of this page's upload, and which transfer they belong to. */
    const [uploaded, setUploaded] = useState<{ id: string; bytes: number }>({
        id: '',
        bytes: 0,
    });
    const [uploadError, setUploadError] = useState<string | null>(null);
    const uploadRef = useRef<Upload | null>(null);

    // Capabilities, read again on every open.
    useEffect(() => {
        if (!open) return;
        let stopped = false;
        transfersApi
            .capabilities(workspace)
            .then((c) => {
                if (stopped) return;
                setCaps(c);
                setCapsError(null);
            })
            .catch(
                (e: unknown) =>
                    !stopped &&
                    setCapsError(
                        apiMessage(e, "Couldn't read the restore options."),
                    ),
            );
        return () => {
            stopped = true;
        };
    }, [open, workspace]);

    // The server may know the connection is read-only even when this page doesn't yet.
    useEffect(() => {
        if (open && caps?.read_only) onOpenChange(false);
    }, [open, caps, onOpenChange]);

    // The file's first lines say which engine made it.
    useEffect(() => {
        setSniffed(null);
        if (file === null) return;
        let stopped = false;
        readHead(file)
            .then((head) => !stopped && setSniffed(sniffDumpEngine(head)))
            .catch(() => {
                // Unreadable here: the server still checks the file.
            });
        return () => {
            stopped = true;
        };
    }, [file]);

    /** Stops this page's upload; with `cancel`, also asks the server to drop the transfer and its partial file. */
    const stopUpload = useCallback((cancel: boolean) => {
        const upload = uploadRef.current;
        if (upload === null) return;
        uploadRef.current = null;
        upload.controller.abort();
        setUploadPhase('stopping');
        if (cancel)
            transfersApi.cancel(upload.workspace, upload.id).catch(() => {
                // The page is going away or the transfer already ended: nothing to show.
            });
    }, []);

    // An upload needs the page: closing the dialog or leaving stops it.
    /** Whether the dialog is open and mounted: a restore that starts after that is cancelled, not uploaded. */
    const shownRef = useRef(open);
    useEffect(() => {
        shownRef.current = open;
        if (!open) stopUpload(true);
    }, [open, stopUpload]);
    useEffect(
        () => () => {
            shownRef.current = false;
            stopUpload(true);
        },
        [stopUpload],
    );
    // A reload, a closed tab or navigating away: a normal request would be dropped with the page, so the cancel goes
    // out as a keepalive request. (The server also abandons an upload that stops receiving chunks.)
    useEffect(() => {
        const onPageHide = () => {
            const upload = uploadRef.current;
            if (upload === null) return;
            uploadRef.current = null;
            upload.controller.abort();
            void transfersApi.cancelOnLeave(upload.workspace, upload.id);
        };
        window.addEventListener('pagehide', onPageHide);
        return () => window.removeEventListener('pagehide', onPageHide);
    }, []);

    // Focus follows the step: the status after Restore (or Show), the file picker after New restore.
    const statusRef = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const [focusTo, setFocusTo] = useState<'status' | 'form' | null>(null);
    useEffect(() => {
        if (focusTo === null) return;
        (focusTo === 'status' ? statusRef : fileRef).current?.focus();
        setFocusTo(null);
    }, [focusTo, active]);

    const native = caps?.import.native ?? null;
    const {
        setMethod,
        effective,
        line: methodLine,
        requested: requestedMethod,
    } = useMethod(native, caps?.import.default_method ?? null);

    const database =
        caps?.database_name ?? connection.database ?? connection.name;
    const engine = [
        connection.driver_label,
        serverVersion ? shortVersion(serverVersion) : null,
    ]
        .filter(Boolean)
        .join(' ');
    const mismatch =
        sniffed !== null && family(sniffed) !== family(connection.driver);

    const canStart =
        caps !== null &&
        file !== null &&
        confirm === caps.database_name &&
        !starting;

    // Stable: TransferStatus reports through an effect that depends on it.
    const onDone = useCallback(() => {
        stopUpload(false);
        setUploadPhase(null);
        setFinished(true);
        setRecentKey((k) => k + 1);
    }, [stopUpload]);

    const upload = (chosen: File, t: Transfer) => {
        const controller = new AbortController();
        uploadRef.current = { controller, workspace, id: t.id };
        setUploaded({ id: t.id, bytes: 0 });
        setUploadPhase('sending');
        uploadInChunks(chosen, transfersApi.uploadUrl(workspace, t.id), {
            onProgress: (bytes) =>
                !controller.signal.aborted && setUploaded({ id: t.id, bytes }),
            signal: controller.signal,
        })
            .then(() => {
                if (uploadRef.current?.controller !== controller) return;
                uploadRef.current = null;
                setUploadPhase('sent');
            })
            .catch((e: unknown) => {
                if (controller.signal.aborted) return;
                if (uploadRef.current?.controller === controller)
                    uploadRef.current = null;
                setUploadPhase(null);
                // The transfer ended on the server (cancelled elsewhere, abandoned, failed to queue): the status
                // shows that outcome, and there is nothing left to cancel.
                if (
                    e instanceof UploadError &&
                    e.status === 409 &&
                    (e.transferStatus === 'cancelled' ||
                        e.transferStatus === 'failed')
                )
                    return;
                setUploadError(
                    e instanceof Error && e.message
                        ? e.message
                        : "Couldn't upload the file.",
                );
                // The server deletes what was sent and frees the database.
                transfersApi.cancel(workspace, t.id).catch(() => {});
            });
    };

    const start = () => {
        if (!canStart) return;
        const chosen = file;
        setStarting(true);
        setStartError(null);
        setUploadError(null);
        transfersApi
            .startImport(workspace, {
                file_name: chosen.name,
                size: chosen.size,
                confirm,
                method: requestedMethod,
            })
            .then((t) => {
                if (!shownRef.current) {
                    // Closed while the restore was starting: there is no page left to upload from.
                    transfersApi.cancel(workspace, t.id).catch(() => {});
                    return;
                }
                setFinished(!ACTIVE_STATUSES.includes(t.status));
                setActive(t);
                setFocusTo('status');
                setRecentKey((k) => k + 1);
                if (t.status === 'uploading') upload(chosen, t);
            })
            .catch((e: unknown) =>
                setStartError(apiMessage(e, "Couldn't start the restore.")),
            )
            .finally(() => setStarting(false));
    };

    /** Empties the form: the file and the typed name never carry over to another restore. */
    const clearForm = useCallback(() => {
        setFile(null);
        setConfirm('');
        setStartError(null);
        if (fileRef.current) fileRef.current.value = '';
    }, []);

    // Closed with nothing started: the next open starts from an empty form.
    useEffect(() => {
        if (!open && active === null) clearForm();
    }, [open, active, clearForm]);

    const newRestore = () => {
        setActive(null);
        setFinished(false);
        clearForm();
        setUploadError(null);
        setFocusTo('form');
    };

    const fileId = useId();
    const confirmId = useId();

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => {
                if (!o) stopUpload(true);
                onOpenChange(o);
            }}
        >
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle className="text-base">
                        Restore into {database}
                        {engine && ' '}
                        {engine && (
                            <span className="font-normal text-muted-foreground">
                                ({engine})
                            </span>
                        )}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        Runs the statements of an SQL file against this
                        database.
                    </DialogDescription>
                </DialogHeader>

                {active ? (
                    <div className="grid gap-3">
                        <div
                            ref={statusRef}
                            tabIndex={-1}
                            role="region"
                            aria-label="Restore progress"
                            className="rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                            <TransferStatus
                                key={active.id}
                                workspace={workspace}
                                transfer={active}
                                onDone={onDone}
                                onCancel={() => stopUpload(false)}
                                keepsApplied={
                                    connection.driver === 'mysql' ||
                                    connection.driver === 'mariadb'
                                }
                                uploaded={
                                    active.id === uploaded.id
                                        ? uploaded.bytes
                                        : undefined
                                }
                                uploadNote={
                                    active.id !== uploaded.id ||
                                    uploadPhase === null
                                        ? undefined
                                        : uploadPhase === 'sent'
                                          ? UPLOAD_SENT_NOTE
                                          : UPLOAD_NOTE
                                }
                            />
                        </div>
                        {uploadError && (
                            <div
                                role="alert"
                                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                            >
                                <p className="font-medium text-destructive">
                                    The upload failed.
                                </p>
                                <p className="mt-1 text-xs break-words whitespace-pre-wrap">
                                    {uploadError}
                                </p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="grid gap-4">
                        <Row label="File" htmlFor={fileId}>
                            {/* The native input, transparent over a button of our own: its own "No file chosen" /
                                file name text would repeat the line below. It keeps the focus, the label and the
                                click that opens the file picker. */}
                            <div className="relative w-fit">
                                <input
                                    ref={fileRef}
                                    id={fileId}
                                    type="file"
                                    accept={ACCEPTED_FILES}
                                    onChange={(e) =>
                                        setFile(e.target.files?.[0] ?? null)
                                    }
                                    className="peer absolute inset-0 size-full cursor-pointer opacity-0"
                                />
                                <span
                                    aria-hidden
                                    className="pointer-events-none inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground peer-hover:bg-accent peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50"
                                >
                                    {file
                                        ? 'Choose another file…'
                                        : 'Choose a file…'}
                                </span>
                            </div>
                            {file && (
                                <p className="flex min-w-0 items-baseline gap-1 text-sm">
                                    <span className="truncate font-mono text-[12.5px]">
                                        {file.name}
                                    </span>
                                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                        · {formatBytes(file.size)}
                                    </span>
                                </p>
                            )}
                            {mismatch && sniffed && (
                                <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
                                    <TriangleAlert
                                        className="mt-px size-3.5 shrink-0 text-warning"
                                        aria-hidden
                                    />
                                    <span>
                                        This file looks like a{' '}
                                        {ENGINE_LABEL[sniffed]} dump; this
                                        database is {connection.driver_label}.
                                    </span>
                                </p>
                            )}
                        </Row>
                        <Row label="Method">
                            <MethodChoice
                                native={native}
                                effective={effective}
                                line={methodLine}
                                onChoose={setMethod}
                            />
                            {capsError && (
                                <p className="text-xs text-destructive">
                                    {capsError}
                                </p>
                            )}
                        </Row>
                        <Row label="On error">
                            <span className="text-sm">
                                Stop at the first failing statement
                            </span>
                        </Row>
                        <div className="grid gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
                            <div className="flex items-start gap-2">
                                <TriangleAlert
                                    className="mt-0.5 size-4 shrink-0 text-warning"
                                    aria-hidden
                                />
                                <div className="grid gap-1">
                                    <p>
                                        This runs every statement in the file
                                        against {database}. Existing tables may
                                        be dropped or overwritten.
                                    </p>
                                    {caps && (
                                        <p className="text-muted-foreground">
                                            {caps.import.all_or_nothing
                                                ? 'If a statement fails, nothing is changed. The database stays locked until the restore finishes.'
                                                : 'If a statement fails, the statements before it stay applied.'}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <label
                                htmlFor={confirmId}
                                className="text-sm text-muted-foreground"
                            >
                                Type{' '}
                                <span className="font-mono text-foreground">
                                    {database}
                                </span>{' '}
                                to confirm
                            </label>
                            <Input
                                id={confirmId}
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                autoComplete="off"
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                                className="h-8 bg-background font-mono"
                            />
                        </div>
                        {startError && (
                            <p
                                role="alert"
                                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm whitespace-pre-wrap text-destructive"
                            >
                                {startError}
                            </p>
                        )}
                    </div>
                )}

                {open && (
                    <RecentTransfers
                        workspace={workspace}
                        refreshKey={recentKey}
                        direction="import"
                        exclude={active?.id ?? null}
                        onShow={(t) => {
                            setUploadError(null);
                            setFinished(false);
                            setActive(t);
                            setFocusTo('status');
                        }}
                    />
                )}

                <DialogFooter>
                    {active ? (
                        <>
                            {finished && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={newRestore}
                                >
                                    New restore
                                </Button>
                            )}
                            <DialogClose asChild>
                                <Button type="button">Close</Button>
                            </DialogClose>
                        </>
                    ) : (
                        <>
                            <DialogClose asChild>
                                <Button type="button" variant="outline">
                                    Cancel
                                </Button>
                            </DialogClose>
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={!canStart}
                                onClick={start}
                            >
                                {starting ? 'Starting…' : 'Restore'}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
