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
    TableMode,
    Transfer,
    TransferCapabilities,
} from '@/lib/transfers-api';
import type { ConnectionSummary } from '@/types/connection';
import { MethodChoice, Row, radioClass, useMethod } from './form-parts';
import { RecentTransfers } from './recent-transfers';
import { TransferStatus, apiMessage } from './transfer-status';

/** Capabilities are read again this long after the chosen tables last changed (the native gaps depend on them). */
export const CAPABILITIES_DEBOUNCE_MS = 400;

/** A mix that needs the built-in method warns from this many estimated rows (with data) on. */
export const BIG_BACKUP_ROWS = 1_000_000;

const MODE_LABELS: Record<TableMode, string> = {
    both: 'Structure + data',
    structure: 'Structure only',
    data: 'Data only',
};
const MODES = Object.keys(MODE_LABELS) as TableMode[];

const selectClass =
    'h-6 shrink-0 rounded-md border bg-background px-1 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';

const includesStructure = (m: TableMode) => m !== 'data';
const includesData = (m: TableMode) => m !== 'structure';
/** The mode the Include checkboxes describe; null when neither is on. */
const modeOf = (structure: boolean, data: boolean): TableMode | null =>
    structure && data ? 'both' : structure ? 'structure' : data ? 'data' : null;

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
    mode,
    onToggle,
    onMode,
}: {
    object: DumpObject;
    id: string;
    checked: boolean;
    /** The ticked table's mode; undefined for a view or an unticked row (no selector). */
    mode: TableMode | undefined;
    onToggle: (key: string, on: boolean) => void;
    onMode: (key: string, mode: TableMode) => void;
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
            {mode !== undefined && (
                <select
                    aria-label={`Mode for ${o.name}`}
                    className={selectClass}
                    value={mode}
                    onChange={(e) => onMode(o.key, e.target.value as TableMode)}
                >
                    {MODES.map((m) => (
                        <option key={m} value={m}>
                            {MODE_LABELS[m]}
                        </option>
                    ))}
                </select>
            )}
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
    modes,
    onToggle,
    onSetMany,
    onMode,
    filterRef,
    bySchema,
}: {
    objects: DumpObject[];
    chosen: Set<string>;
    /** The mode of each ticked table (views have none). */
    modes: Record<string, TableMode>;
    /** All callbacks stable (useCallback): the memoised rows rely on it. */
    onToggle: (key: string, on: boolean) => void;
    onSetMany: (keys: string[], on: boolean) => void;
    onMode: (key: string, mode: TableMode) => void;
    filterRef: React.Ref<HTMLInputElement>;
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
            mode={chosen.has(o.key) ? modes[o.key] : undefined}
            onToggle={onToggle}
            onMode={onMode}
        />
    );
    const chosenShown = q
        ? visible.some((o) => chosen.has(o.key))
        : chosen.size > 0;

    return (
        <div className="grid gap-1.5">
            <div className="flex items-center gap-2">
                <Input
                    ref={filterRef}
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
            {Object.entries(modes).some(
                ([k, m]) => chosen.has(k) && m === 'data',
            ) && (
                <p className="text-xs text-muted-foreground">
                    Data only: on restore its rows are added to an existing
                    table; the table is not created or replaced.
                </p>
            )}
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
    /** The mode of each ticked table; views never get one. */
    const [modes, setModes] = useState<Record<string, TableMode>>({});
    const [confirming, setConfirming] = useState(false);
    const [structure, setStructure] = useState(true);
    const [data, setData] = useState(true);
    const [drop, setDrop] = useState(true);
    const [gzip, setGzip] = useState(true);

    const [active, setActive] = useState<Transfer | null>(null);
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);
    const [finished, setFinished] = useState(false);
    const [recentKey, setRecentKey] = useState(0);
    const filterRef = useRef<HTMLInputElement>(null);
    /** For the stable callbacks below: which keys are tables, and what a new tick starts as. */
    const tableKeys = useRef(new Set<string>());
    const defaultMode = useRef<TableMode>('both');

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
                tableKeys.current = new Set(
                    r.objects
                        .filter((o) => o.kind === 'table')
                        .map((o) => o.key),
                );
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

    useEffect(() => {
        defaultMode.current = modeOf(structure, data) ?? 'both';
    }, [structure, data]);

    /**
     * The Include checkboxes set the mode of every ticked table (and of tables ticked later); a table's own
     * selector can still change it afterwards. Both off changes nothing: the backup can't start that way.
     */
    const setInclude = (nextStructure: boolean, nextData: boolean) => {
        setStructure(nextStructure);
        setData(nextData);
        const m = modeOf(nextStructure, nextData);
        if (m === null) return;
        setModes((prev) =>
            Object.fromEntries(Object.keys(prev).map((k) => [k, m])),
        );
    };

    /** Ticking a table gives it the Include checkboxes' mode; unticking forgets it. */
    const onSetMany = useCallback((keys: string[], on: boolean) => {
        setChosen((prev) => {
            const next = new Set(prev);
            keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
            return next;
        });
        setModes((prev) => {
            const next = { ...prev };
            for (const k of keys) {
                if (!on) delete next[k];
                else if (tableKeys.current.has(k) && !(k in next))
                    next[k] = defaultMode.current;
            }
            return next;
        });
    }, []);
    const onToggle = useCallback(
        (key: string, on: boolean) => onSetMany([key], on),
        [onSetMany],
    );
    const onMode = useCallback(
        (key: string, mode: TableMode) =>
            setModes((prev) => ({ ...prev, [key]: mode })),
        [],
    );

    /**
     * Only the All radio means "all" (which also takes routines and events where the engine has them). Choose…
     * always sends its explicit list, even with every box ticked.
     */
    const everything = mode === 'all';
    /** The ticked tables' modes (never with All, never for views, none for a table that has gone). */
    const tableModes = useMemo(() => {
        const out: Record<string, TableMode> = {};
        if (everything) return out;
        for (const k of [...chosen].sort()) if (modes[k]) out[k] = modes[k];
        return out;
    }, [everything, chosen, modes]);
    const tickedModes = Object.values(tableModes);
    const distinctModes = new Set(tickedModes);
    /**
     * Only ticked tables that differ are sent per table. When they all share one mode, that mode becomes the
     * global structure / data and the backup runs exactly as one without per-table modes (natively when it can).
     */
    const mixed = distinctModes.size > 1;
    const uniformMode =
        distinctModes.size === 1 ? (tickedModes[0] as TableMode) : null;
    const sentStructure =
        uniformMode !== null ? includesStructure(uniformMode) : structure;
    const sentData = uniformMode !== null ? includesData(uniformMode) : data;
    const sentModes = mixed ? tableModes : null;
    // Capabilities for the chosen set: at once on open, then debounced while the choice changes.
    const keysId = useMemo(
        () =>
            everything
                ? '*'
                : JSON.stringify({ k: [...chosen].sort(), m: sentModes ?? {} }),
        [everything, chosen, sentModes],
    );
    // The warning must describe the current choice.
    useEffect(() => setConfirming(false), [keysId]);
    const capsReadOnce = useRef(false);
    /** A re-read is due or on its way: what's included isn't known yet. */
    const [capsPending, setCapsPending] = useState(false);
    useEffect(() => {
        if (!open) {
            capsReadOnce.current = false;
            return;
        }
        const parsed =
            keysId === '*'
                ? null
                : (JSON.parse(keysId) as {
                      k: string[];
                      m: Record<string, TableMode>;
                  });
        const keys = parsed?.k;
        const keyModes =
            parsed && Object.keys(parsed.m).length > 0 ? parsed.m : undefined;
        if (keys !== undefined && keys.length === 0) {
            setCapsPending(false);
            return;
        }
        // Cleared by the next run of this effect, so a slower, older answer is dropped.
        let stopped = false;
        setCapsPending(true);
        const read = () =>
            transfersApi
                .capabilities(workspace, keys, keyModes)
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
    const {
        setMethod,
        effective,
        line: methodLine,
        requested: requestedMethod,
    } = useMethod(native, caps?.export.default_method ?? null);
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

    /** Will the request write any structure (and so DROP statements)? Views take the global structure. */
    const anyStructure =
        everything || chosen.size === 0
            ? structure
            : tickedModes.some(includesStructure) ||
              ([...chosen].some((k) => !(k in tableModes)) && sentStructure);
    /** Estimated rows the backup writes from tables whose mode includes data. */
    const dataRows = useMemo(() => {
        const rows = new Map(objects?.map((o) => [o.key, o.rows]) ?? []);
        return Object.entries(tableModes)
            .filter(([, m]) => includesData(m))
            .reduce((sum, [k]) => sum + (rows.get(k) ?? 0), 0);
    }, [objects, tableModes]);
    const warnBig =
        caps?.export.mix_needs_builtin === true &&
        mixed &&
        dataRows >= BIG_BACKUP_ROWS;

    const start = (confirmed = false) => {
        if (!canStart) return;
        if (warnBig && !confirmed) {
            setConfirming(true);
            return;
        }
        setConfirming(false);
        setStarting(true);
        setStartError(null);
        transfersApi
            .startExport(workspace, {
                tables: everything ? 'all' : [...chosen],
                ...(sentModes ? { table_modes: sentModes } : {}),
                structure: sentStructure,
                data: sentData,
                drop: anyStructure && drop,
                gzip,
                // A native choice made before native turned out unusable (for the chosen tables) falls back.
                method: requestedMethod,
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
                                    modes={tableModes}
                                    onToggle={onToggle}
                                    onSetMany={onSetMany}
                                    onMode={onMode}
                                    filterRef={filterRef}
                                    bySchema={connection.driver === 'pgsql'}
                                />
                            )}
                        </Row>
                        <Row label="Include">
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                                <Check
                                    label="Structure"
                                    checked={structure}
                                    onChange={(v) => setInclude(v, data)}
                                />
                                <Check
                                    label="Data"
                                    checked={data}
                                    onChange={(v) => setInclude(structure, v)}
                                />
                            </div>
                            {!structure && !data && (
                                <p className="text-xs text-muted-foreground">
                                    Include structure, data or both.
                                </p>
                            )}
                        </Row>
                        {anyStructure && (
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
                            <MethodChoice
                                native={native}
                                effective={effective}
                                line={methodLine}
                                onChoose={setMethod}
                            />
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
                        {confirming && (
                            <div
                                role="alert"
                                className="grid gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
                            >
                                <p>
                                    This mix of tables needs the built-in
                                    method, which is slower than{' '}
                                    {caps?.export.native.tool ??
                                        'the native tool'}{' '}
                                    for about {(dataRows / 1e6).toFixed(1)}{' '}
                                    million rows.
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => start(true)}
                                    >
                                        Back up anyway
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setConfirming(false);
                                            filterRef.current?.focus();
                                        }}
                                    >
                                        Change tables
                                    </Button>
                                </div>
                            </div>
                        )}
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
                                onClick={() => start()}
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
