import { Info } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
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

function TablePicker({
    objects,
    chosen,
    onChange,
    bySchema,
}: {
    objects: DumpObject[];
    chosen: Set<string>;
    onChange: (next: Set<string>) => void;
    bySchema: boolean;
}) {
    const [query, setQuery] = useState('');
    const baseId = useId();
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

    const toggle = (key: string, on: boolean) => {
        const next = new Set(chosen);
        if (on) next.add(key);
        else next.delete(key);
        onChange(next);
    };
    const setVisible = (on: boolean) => {
        const next = new Set(chosen);
        visible.forEach((o) => (on ? next.add(o.key) : next.delete(o.key)));
        onChange(next);
    };

    const item = (o: DumpObject, i: number) => {
        const id = `${baseId}-${i}`;
        return (
            <li key={o.key} className="flex items-center gap-2 px-1 py-0.5">
                <Checkbox
                    id={id}
                    checked={chosen.has(o.key)}
                    onCheckedChange={(v) => toggle(o.key, v === true)}
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
    };

    let index = 0;
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
                    disabled={chosen.size === 0}
                >
                    Clear
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
                            <ul>{list.map((o) => item(o, index++))}</ul>
                        </div>
                    ) : (
                        <ul key="all">{list.map((o) => item(o, index++))}</ul>
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
            .then((r) => !stopped && setObjects(r.objects))
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

    // Capabilities for the chosen set: at once on open, then debounced while the choice changes.
    const keysId = useMemo(
        () => (mode === 'all' ? '*' : JSON.stringify([...chosen].sort())),
        [mode, chosen],
    );
    const capsReadOnce = useRef(false);
    useEffect(() => {
        if (!open) {
            capsReadOnce.current = false;
            return;
        }
        const keys =
            keysId === '*' ? undefined : (JSON.parse(keysId) as string[]);
        if (keys !== undefined && keys.length === 0) return;
        let stopped = false;
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
                );
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
    const infoLine =
        gaps.length === 0
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
        !starting &&
        (structure || data) &&
        (mode === 'all' || chosen.size > 0);

    const start = () => {
        if (!canStart) return;
        setStarting(true);
        setStartError(null);
        transfersApi
            .startExport(workspace, {
                tables: mode === 'all' ? 'all' : [...chosen],
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
                    <TransferStatus
                        key={active.id}
                        workspace={workspace}
                        transfer={active}
                        onDone={() => {
                            setFinished(true);
                            setRecentKey((k) => k + 1);
                        }}
                    />
                ) : (
                    <div className="grid gap-4">
                        <Row label="Tables">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                <label className="inline-flex items-center gap-2 text-sm">
                                    <input
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
                                    onChange={setChosen}
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
                        exclude={active?.id ?? null}
                        onShow={(t) => {
                            setFinished(false);
                            setActive(t);
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
