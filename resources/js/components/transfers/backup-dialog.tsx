import { Info } from 'lucide-react';
import {
    memo,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { shortVersion } from '@/lib/format';
import { ACTIVE_STATUSES, transfersApi } from '@/lib/transfers-api';
import type {
    DumpObject,
    Transfer,
    TransferCapabilities,
    TransferMethod,
} from '@/lib/transfers-api';
import { cn } from '@/lib/utils';
import type { ConnectionSummary } from '@/types/connection';
import { RecentTransfers } from './recent-transfers';
import { TransferStatus, apiMessage } from './transfer-status';

/** Capabilities are read again this long after the chosen tables last changed (the native gaps depend on them). */
export const CAPABILITIES_DEBOUNCE_MS = 400;

const radioClass =
    'size-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-50';

/** One labelled row of the form: the label column, then its controls. */
function Row({ label, children }: { label: string; children: ReactNode }) {
    const id = useId();
    return (
        <div
            role="group"
            aria-labelledby={id}
            className="grid grid-cols-[5.5rem_1fr] items-start gap-x-3 gap-y-2"
        >
            <span id={id} className="pt-px text-sm text-muted-foreground">
                {label}
            </span>
            <div className="grid min-w-0 gap-2">{children}</div>
        </div>
    );
}

function Check({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    const id = useId();
    return (
        <span className="inline-flex items-center gap-2">
            <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(v) => onChange(v === true)}
            />
            <label htmlFor={id} className="text-sm">
                {label}
            </label>
        </span>
    );
}

/** The objects to pick from, by schema on PostgreSQL (one unnamed group elsewhere). */
function groupObjects(objects: DumpObject[]): [string | null, DumpObject[]][] {
    const groups = new Map<string | null, DumpObject[]>();
    for (const o of objects) {
        const list = groups.get(o.schema) ?? [];
        list.push(o);
        groups.set(o.schema, list);
    }
    return [...groups.entries()];
}

/** One checklist row. Memoised on `checked`, so a toggle re-renders only its own row. */
const PickerRow = memo(function PickerRow({
    object: o,
    id,
    checked,
    onToggle,
}: {
    object: DumpObject;
    id: string;
    checked: boolean;
    onToggle: (key: string, on: boolean) => void;
}) {
    return (
        <li className="flex items-center gap-2 px-1 py-0.5">
            <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(v) => onToggle(o.key, v === true)}
            />
            <label
                htmlFor={id}
                className="flex min-w-0 flex-1 items-baseline gap-1.5"
            >
                <span className="truncate font-mono text-[12.5px]">
                    {o.name}
                </span>
                {o.kind !== 'table' && (
                    <span className="text-[10px] text-muted-foreground">
                        {o.kind}
                    </span>
                )}
            </label>
            {o.rows !== null && (
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {o.rows.toLocaleString('en')} rows
                </span>
            )}
        </li>
    );
});

function TablePicker({
    objects,
    chosen,
    onToggle,
    onSetMany,
    bySchema,
}: {
    objects: DumpObject[];
    chosen: Set<string>;
    /** Both stable (useCallback): the memoised rows rely on it. */
    onToggle: (key: string, on: boolean) => void;
    onSetMany: (keys: string[], on: boolean) => void;
    bySchema: boolean;
}) {
    const [query, setQuery] = useState('');
    const baseId = useId();
    /** Each object's position in the full list: a row id that doesn't change while filtering. */
    const positions = useMemo(
        () => new Map(objects.map((o, i) => [o.key, i])),
        [objects],
    );
    const q = query.trim().toLowerCase();
    const visible = q
        ? objects.filter((o) =>
              `${o.schema ? `${o.schema}.` : ''}${o.name}`
                  .toLowerCase()
                  .includes(q),
          )
        : objects;
    const groups = bySchema
        ? groupObjects(visible)
        : ([[null, visible]] as [string | null, DumpObject[]][]);

    const setVisible = (on: boolean) =>
        onSetMany(
            visible.map((o) => o.key),
            on,
        );

    const item = (o: DumpObject) => (
        <PickerRow
            key={o.key}
            object={o}
            id={`${baseId}-${positions.get(o.key) ?? 0}`}
            checked={chosen.has(o.key)}
            onToggle={onToggle}
        />
    );
    const chosenShown = q
        ? visible.some((o) => chosen.has(o.key))
        : chosen.size > 0;

    return (
        <div className="grid gap-1.5">
            <div className="flex items-center gap-2">
                <Input
                    type="search"
                    aria-label="Filter tables"
                    placeholder="Filter tables…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="h-8"
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisible(true)}
                    disabled={visible.length === 0}
                >
                    Select {q ? 'shown' : 'all'}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisible(false)}
                    disabled={!chosenShown}
                >
                    Clear {q ? 'shown' : 'all'}
                </Button>
            </div>
            <div className="max-h-56 overflow-auto rounded-md border p-1">
                {visible.length === 0 && (
                    <p className="px-1 py-2 text-xs text-muted-foreground">
                        No tables match.
                    </p>
                )}
                {groups.map(([schema, list]) =>
                    bySchema ? (
                        <div
                            key={schema ?? ''}
                            role="group"
                            aria-label={schema ?? ''}
                            className="py-0.5"
                        >
                            <p
                                aria-hidden
                                className="px-1 pt-1 text-[10px] tracking-wide text-muted-foreground uppercase"
                            >
                                {schema}
                            </p>
                            <ul>{list.map(item)}</ul>
                        </div>
                    ) : (
                        <ul key="all">{list.map(item)}</ul>
                    ),
                )}
            </div>
            <p className="text-xs text-muted-foreground" aria-live="polite">
                {chosen.size.toLocaleString('en')} of{' '}
                {objects.length.toLocaleString('en')} chosen
            </p>
        </div>
    );
}

/**
 * Back up the open database (spec §2): which tables, structure and/or data, DROP statements, compression and the
 * method, then the running backup's progress and its download.
 */
export function BackupDialog({
    connection,
    open,
    onOpenChange,
    serverVersion = null,
}: {
    connection: ConnectionSummary;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The server version from the schema snapshot, for the title. */
    serverVersion?: string | null;
}) {
    const workspace = connection.ref;
    const [caps, setCaps] = useState<TransferCapabilities | null>(null);
    const [capsError, setCapsError] = useState<string | null>(null);
    const [objects, setObjects] = useState<DumpObject[] | null>(null);
    const [objectsError, setObjectsError] = useState<string | null>(null);

    const [mode, setMode] = useState<'all' | 'choose'>('all');
    const [chosen, setChosen] = useState<Set<string>>(() => new Set());
    const [structure, setStructure] = useState(true);
    const [data, setData] = useState(true);
    const [drop, setDrop] = useState(true);
    const [gzip, setGzip] = useState(true);
    /** The user's choice; null keeps the server's default. */
    const [method, setMethod] = useState<TransferMethod | null>(null);
    const [methodOpen, setMethodOpen] = useState(false);

    const [active, setActive] = useState<Transfer | null>(null);
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);
    const [finished, setFinished] = useState(false);
    const [recentKey, setRecentKey] = useState(0);

    // The object list, read again on every open.
    useEffect(() => {
        if (!open) return;
        let stopped = false;
        setObjectsError(null);
        transfersApi
            .objects(workspace)
            .then((r) => {
                if (stopped) return;
                setObjects(r.objects);
                // A table dropped since the list was last read must not stay chosen.
                const known = new Set(r.objects.map((o) => o.key));
                setChosen((prev) =>
                    [...prev].every((k) => known.has(k))
                        ? prev
                        : new Set([...prev].filter((k) => known.has(k))),
                );
            })
            .catch(
                (e: unknown) =>
                    !stopped &&
                    setObjectsError(
                        apiMessage(e, "Couldn't list the database's tables."),
                    ),
            );
        return () => {
            stopped = true;
        };
    }, [open, workspace]);

    const onToggle = useCallback(
        (key: string, on: boolean) =>
            setChosen((prev) => {
                const next = new Set(prev);
                if (on) next.add(key);
                else next.delete(key);
                return next;
            }),
        [],
    );
    const onSetMany = useCallback(
        (keys: string[], on: boolean) =>
            setChosen((prev) => {
                const next = new Set(prev);
                keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
                return next;
            }),
        [],
    );

    /**
     * Only the All radio means "all" (which also takes routines and events where the engine has them). Choose…
     * always sends its explicit list, even with every box ticked.
     */
    const everything = mode === 'all';
    // Capabilities for the chosen set: at once on open, then debounced while the choice changes.
    const keysId = useMemo(
        () => (everything ? '*' : JSON.stringify([...chosen].sort())),
        [everything, chosen],
    );
    const capsReadOnce = useRef(false);
    /** A re-read is due or on its way: what's included isn't known yet. */
    const [capsPending, setCapsPending] = useState(false);
    useEffect(() => {
        if (!open) {
            capsReadOnce.current = false;
            return;
        }
        const keys =
            keysId === '*' ? undefined : (JSON.parse(keysId) as string[]);
        if (keys !== undefined && keys.length === 0) {
            setCapsPending(false);
            return;
        }
        // Cleared by the next run of this effect, so a slower, older answer is dropped.
        let stopped = false;
        setCapsPending(true);
        const read = () =>
            transfersApi
                .capabilities(workspace, keys)
                .then((c) => {
                    if (stopped) return;
                    setCaps(c);
                    setCapsError(null);
                })
                .catch(
                    (e: unknown) =>
                        !stopped &&
                        setCapsError(
                            apiMessage(e, "Couldn't read the backup options."),
                        ),
                )
                .finally(() => !stopped && setCapsPending(false));
        if (!capsReadOnce.current) {
            capsReadOnce.current = true;
            void read();
            return () => {
                stopped = true;
            };
        }
        const timer = setTimeout(read, CAPABILITIES_DEBOUNCE_MS);
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [open, workspace, keysId]);

    // Focus follows the step: the status after Back up (or Show), the form's first control after New backup.
    const statusRef = useRef<HTMLDivElement>(null);
    const firstControlRef = useRef<HTMLInputElement>(null);
    const [focusTo, setFocusTo] = useState<'status' | 'form' | null>(null);
    useEffect(() => {
        if (focusTo === null) return;
        (focusTo === 'status' ? statusRef : firstControlRef).current?.focus();
        setFocusTo(null);
    }, [focusTo, active]);

    const native = caps?.export.native ?? null;
    const effective: TransferMethod | null = caps
        ? native?.usable
            ? (method ?? caps.export.default_method)
            : 'builtin'
        : null;
    const methodLine =
        effective === null || native === null
            ? 'Checking…'
            : effective === 'native'
              ? `Native — ${native.reason}`
              : native.usable
                ? 'Built-in'
                : native.reason;
    const gaps =
        effective === 'native'
            ? (caps?.export.native_gaps ?? [])
            : (caps?.export.builtin_gaps ?? []);
    const infoLine = capsPending
        ? 'Checking…'
        : gaps.length === 0
          ? 'Includes everything in the chosen tables.'
          : `Not included: ${gaps.join(', ')}.`;

    const database =
        caps?.database_name ?? connection.database ?? connection.name;
    const engine = [
        connection.driver_label,
        serverVersion ? shortVersion(serverVersion) : null,
    ]
        .filter(Boolean)
        .join(' ');

    const canStart =
        caps !== null &&
        !capsPending &&
        !starting &&
        (structure || data) &&
        (mode === 'all' || chosen.size > 0);

    // Stable: TransferStatus reports through an effect that depends on it.
    const onDone = useCallback(() => {
        setFinished(true);
        setRecentKey((k) => k + 1);
    }, []);

    const start = () => {
        if (!canStart) return;
        setStarting(true);
        setStartError(null);
        transfersApi
            .startExport(workspace, {
                tables: everything ? 'all' : [...chosen],
                structure,
                data,
                drop: structure && drop,
                gzip,
                // A native choice made before native turned out unusable (for the chosen tables) falls back.
                method:
                    method === 'native' && !native?.usable ? 'builtin' : method,
            })
            .then((t) => {
                setFinished(!ACTIVE_STATUSES.includes(t.status));
                setActive(t);
                setFocusTo('status');
                setRecentKey((k) => k + 1);
            })
            .catch((e: unknown) =>
                setStartError(apiMessage(e, "Couldn't start the backup.")),
            )
            .finally(() => setStarting(false));
    };

    const methodName = useId();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle className="text-base">
                        Back up {database}
                        {engine && ' '}
                        {engine && (
                            <span className="font-normal text-muted-foreground">
                                ({engine})
                            </span>
                        )}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        Writes an SQL file of this database that you can
                        download.
                    </DialogDescription>
                </DialogHeader>

                {active ? (
                    <div
                        ref={statusRef}
                        tabIndex={-1}
                        role="region"
                        aria-label="Backup progress"
                        className="rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                        <TransferStatus
                            key={active.id}
                            workspace={workspace}
                            transfer={active}
                            onDone={onDone}
                        />
                    </div>
                ) : (
                    <div className="grid gap-4">
                        <Row label="Tables">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                <label className="inline-flex items-center gap-2 text-sm">
                                    <input
                                        ref={firstControlRef}
                                        type="radio"
                                        name={`${methodName}-tables`}
                                        className={radioClass}
                                        checked={mode === 'all'}
                                        onChange={() => setMode('all')}
                                    />
                                    {objects
                                        ? `All ${objects.length.toLocaleString('en')}`
                                        : 'All'}
                                </label>
                                <label className="inline-flex items-center gap-2 text-sm">
                                    <input
                                        type="radio"
                                        name={`${methodName}-tables`}
                                        className={radioClass}
                                        checked={mode === 'choose'}
                                        disabled={objects === null}
                                        onChange={() => setMode('choose')}
                                    />
                                    Choose…
                                </label>
                            </div>
                            {objectsError && (
                                <p className="text-xs text-destructive">
                                    {objectsError}
                                </p>
                            )}
                            {mode === 'choose' && objects && (
                                <TablePicker
                                    objects={objects}
                                    chosen={chosen}
                                    onToggle={onToggle}
                                    onSetMany={onSetMany}
                                    bySchema={connection.driver === 'pgsql'}
                                />
                            )}
                        </Row>
                        <Row label="Include">
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                                <Check
                                    label="Structure"
                                    checked={structure}
                                    onChange={setStructure}
                                />
                                <Check
                                    label="Data"
                                    checked={data}
                                    onChange={setData}
                                />
                            </div>
                            {!structure && !data && (
                                <p className="text-xs text-muted-foreground">
                                    Include structure, data or both.
                                </p>
                            )}
                        </Row>
                        {structure && (
                            <Row label="Structure">
                                <Check
                                    label="Add DROP … IF EXISTS before each CREATE"
                                    checked={drop}
                                    onChange={setDrop}
                                />
                            </Row>
                        )}
                        <Row label="Output">
                            <Check
                                label="Compress (.sql.gz)"
                                checked={gzip}
                                onChange={setGzip}
                            />
                        </Row>
                        <Row label="Method">
                            <div className="flex min-w-0 items-start gap-2">
                                <span className="min-w-0 flex-1 text-sm">
                                    {methodLine}
                                </span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 shrink-0 px-2 text-xs"
                                    aria-label="Change method"
                                    aria-expanded={methodOpen}
                                    disabled={caps === null}
                                    onClick={() => setMethodOpen((o) => !o)}
                                >
                                    Change
                                </Button>
                            </div>
                            {methodOpen && native && (
                                <div
                                    role="radiogroup"
                                    aria-label="Method"
                                    className="grid gap-1 rounded-md border p-2"
                                >
                                    <label
                                        className={cn(
                                            'inline-flex items-start gap-2 text-sm',
                                            !native.usable &&
                                                'text-muted-foreground',
                                        )}
                                    >
                                        <input
                                            type="radio"
                                            name={`${methodName}-method`}
                                            className={cn(radioClass, 'mt-0.5')}
                                            checked={effective === 'native'}
                                            disabled={!native.usable}
                                            onChange={() => setMethod('native')}
                                        />
                                        <span>
                                            Native
                                            {native.reason && (
                                                <span className="text-muted-foreground">
                                                    {' '}
                                                    — {native.reason}
                                                </span>
                                            )}
                                        </span>
                                    </label>
                                    <label className="inline-flex items-center gap-2 text-sm">
                                        <input
                                            type="radio"
                                            name={`${methodName}-method`}
                                            className={radioClass}
                                            checked={effective === 'builtin'}
                                            onChange={() =>
                                                setMethod('builtin')
                                            }
                                        />
                                        Built-in
                                    </label>
                                </div>
                            )}
                            {caps && (
                                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                    <Info
                                        className="mt-px size-3.5 shrink-0"
                                        aria-hidden
                                    />
                                    <span>{infoLine}</span>
                                </p>
                            )}
                            {capsError && (
                                <p className="text-xs text-destructive">
                                    {capsError}
                                </p>
                            )}
                        </Row>
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
                        direction="export"
                        exclude={active?.id ?? null}
                        onShow={(t) => {
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
                                    onClick={() => {
                                        setActive(null);
                                        setFinished(false);
                                        setFocusTo('form');
                                    }}
                                >
                                    New backup
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
                                disabled={!canStart}
                                onClick={start}
                            >
                                {starting ? 'Starting…' : 'Back up'}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
