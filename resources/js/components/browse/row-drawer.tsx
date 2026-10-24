import {
    ArrowLeft,
    Braces,
    Copy,
    Network,
    PencilLine,
    RotateCcw,
    Trash2,
    Undo2,
    X,
} from 'lucide-react';
import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
} from 'react';
import { toast } from 'sonner';
import {
    DateEditPopover,
    OPEN_PICKER_KEYS,
    opensPicker,
} from '@/components/editing/date-edit-popover';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { blobLabel, cellKind, cellText, type CellValue } from '@/grid/cells';
import { registerEditFlush } from '@/editing/flush-edits';
import { pendingKey, usePending } from '@/editing/pending-store';
import {
    boolValue,
    columnType,
    editorText,
    isBooleanType,
    isJsonType,
    jsonError,
    lineEndProblem,
    lockedFor,
    restoreLineEnds,
    rowTarget,
    shownText,
    truthy,
    UNPINNED_ROW,
    type GridEditing,
} from '@/editing/row-edit';
import { toJSON, writeClipboard } from '@/grid/copy';
import { dateKind, type DateKind } from '@/lib/date-filter';
import type { RowFilter } from '@/lib/workspace-api';
import {
    explorableTable,
    keyDisplay,
    rowRecordTarget,
    type RecordTarget,
} from '@/records/open-record';
import { recordsApi } from '@/records/records-api';
import type { RecordPayload, RelationshipSummary } from '@/records/types';
import type {
    QueryCell,
    QueryColumn,
    SchemaSnapshot,
    TableSchema,
} from '@/types/schema';

/** How the drawer arrives: sliding in when it opens, or a header flash when it switches rows. */
export type DrawerMotion = 'open' | 'change';

type Props = {
    connectionId: number;
    snapshot: SchemaSnapshot;
    table: TableSchema;
    columns: QueryColumn[];
    row: QueryCell[];
    /** 1-based position of the row in the table, shown for rows without a key. */
    rowNumber?: number;
    motion?: DrawerMotion;
    onClose: () => void;
    onStep: (dir: 1 | -1) => void;
    onOpenTable: (table: string, filters: RowFilter[]) => void;
    onExplore: (target: RecordTarget) => void;
    /**
     * Staged editing of the grid's rows (spec §4.2), with `rowIndex` the row's index in them: the drawer's fields
     * edit the same pending changes as the grid. Records reached by a hop are never edited here.
     */
    editing?: GridEditing;
    rowIndex?: number;
    /** The connection is read-only: no "Open to edit" for hopped records. */
    readOnly?: boolean;
};

type Loaded = { id: string; payload: RecordPayload } | null;

const COLLAPSED_LINES = 6;
const LONG_TEXT = 300;

const targetId = (t: RecordTarget) => `${t.table}:${JSON.stringify(t.key)}`;

const ASIDE =
    'row-drawer flex h-full w-[420px] max-w-full shrink-0 flex-col border-l bg-background';

/** Held in the drawer's place while the page holding the row loads. */
export function RowDrawerLoading({
    onClose,
    motion = 'open',
}: {
    onClose: () => void;
    motion?: DrawerMotion;
}) {
    return (
        <aside
            role="complementary"
            aria-label="Row details"
            aria-busy="true"
            data-motion={motion}
            className={`${ASIDE} relative`}
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    onClose();
                }
            }}
        >
            <p className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                <Spinner className="size-3" /> Loading row…
            </p>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 size-7"
                aria-label="Close row details"
                onClick={onClose}
            >
                <X className="size-4" />
            </Button>
        </aside>
    );
}

function formatJson(value: CellValue, pretty: boolean): string {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return JSON.stringify(parsed, null, pretty ? 2 : undefined);
    } catch {
        return cellText(value);
    }
}

function Field({
    column,
    type,
    value,
    lock,
}: {
    column: string;
    type: string;
    value: CellValue;
    /** Why the field can't be edited, on an editable row. */
    lock?: string | null;
}) {
    const [expanded, setExpanded] = useState(false);
    // JSON is pretty-printed by default; the toggle shows it compact, as the grid does.
    const [pretty, setPretty] = useState(true);
    const kind = cellKind(value, type);
    const text =
        kind === 'json'
            ? formatJson(value, pretty)
            : kind === 'binary'
              ? blobLabel(value)
              : cellText(value);
    const collapsible =
        kind === 'json' || kind === 'text'
            ? text.split('\n').length > COLLAPSED_LINES ||
              text.length > LONG_TEXT
            : false;
    const block = kind === 'json' || (kind === 'text' && collapsible);

    return (
        <div className="border-b px-4 py-2 last:border-b-0">
            <dt className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-mono font-medium">
                    {column}{' '}
                    <span className="font-normal text-muted-foreground">
                        {type}
                    </span>
                </span>
                {kind === 'json' && (
                    <button
                        type="button"
                        aria-label={`Pretty-print ${column}`}
                        aria-pressed={pretty}
                        title={
                            pretty ? 'Show compact JSON' : 'Pretty-print JSON'
                        }
                        className={`ml-auto shrink-0 hover:text-foreground ${
                            pretty ? 'text-foreground' : 'text-muted-foreground'
                        }`}
                        onClick={() => setPretty((p) => !p)}
                    >
                        <Braces className="size-3" />
                    </button>
                )}
                {kind !== 'null' && (
                    <button
                        type="button"
                        aria-label={`Copy ${column}`}
                        title={`Copy ${column}`}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => void writeClipboard(cellText(value))}
                    >
                        <Copy className="size-3" />
                    </button>
                )}
            </dt>
            <dd className="mt-1 text-xs break-words">
                {kind === 'null' ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        NULL
                    </span>
                ) : block ? (
                    <>
                        <pre
                            className={`font-mono whitespace-pre-wrap ${
                                collapsible && !expanded
                                    ? 'max-h-[9em] overflow-hidden'
                                    : ''
                            }`}
                        >
                            {text}
                        </pre>
                        {collapsible && (
                            <button
                                type="button"
                                className="mt-1 text-muted-foreground underline hover:text-foreground"
                                onClick={() => setExpanded((e) => !e)}
                            >
                                {expanded ? 'Show less' : 'Show all'}
                            </button>
                        )}
                    </>
                ) : (
                    <span className="font-mono whitespace-pre-wrap">
                        {text === '' ? (
                            <span className="text-muted-foreground">
                                (empty)
                            </span>
                        ) : (
                            text
                        )}
                    </span>
                )}
            </dd>
            {lock && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                    {`Not editable: ${lock}`}
                </p>
            )}
        </div>
    );
}

/** What an editable field needs from the drawer. */
type FieldEdit = {
    /** The value shown: staged, else loaded. */
    value: QueryCell;
    /** The loaded value a staged one replaced. */
    original: QueryCell;
    staged: boolean;
    json: boolean;
    bool: boolean;
    /** A date or datetime column, which gets a calendar button beside its input. */
    date: DateKind | null;
    dialect: GridEditing['dialect'];
    stage: (value: string | null) => void;
    revert: () => void;
    /** Keeps an open draft flushable (Review & commit, stepping rows); returns the unregister. */
    register: (flush: () => boolean) => () => void;
};

const MULTI_LINE_CHARS = 80;

/**
 * A field of an editable row (spec §4.2): text in an input, or a textarea for text, JSON and long or multi-line
 * values. A draft is staged on blur, Enter (Ctrl/Cmd+Enter in a textarea) or a flush; Escape cancels it. JSON is
 * validated first; an invalid draft stays unstaged with the error tied to the field.
 */
function EditableField({
    column,
    type,
    edit,
}: {
    column: string;
    type: string;
    edit: FieldEdit;
}) {
    const id = useId();
    const [draft, setDraft] = useState<string | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const base = editorText(edit.value);
    const multiline =
        edit.json ||
        /text|clob/i.test(type) ||
        /[\r\n]/.test(base) ||
        base.length > MULTI_LINE_CHARS;

    /** Stages the draft; false when it is invalid and stays a draft. */
    const commit = (): boolean => {
        if (draft === undefined) return true;
        // A textarea hands back every line end as \n: the value keeps the line ends it had.
        const value = restoreLineEnds(base, draft);
        const problem = edit.json ? jsonError(value) : null;
        if (problem) {
            setError(problem);
            return false;
        }
        setDraft(undefined);
        setError(null);
        edit.stage(value);
        return true;
    };
    const commitRef = useRef(commit);
    useLayoutEffect(() => {
        commitRef.current = commit;
    });
    const hasDraft = draft !== undefined;
    const { register } = edit;
    useEffect(
        () => (hasDraft ? register(() => commitRef.current()) : undefined),
        [hasDraft, register],
    );
    // A draft still open when the field goes (the drawer closes or moves on) is staged; one that can't be (invalid
    // JSON) is gone with the field, so say so rather than drop it silently.
    useEffect(
        () => () => {
            if (!commitRef.current())
                toast.error(`${column}: invalid JSON, not staged`);
        },
        // The field is keyed by its column: `column` never changes while it is mounted.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );

    const cancel = () => {
        setDraft(undefined);
        setError(null);
    };
    const onKeyDown = (
        e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
        if (edit.date && !multiline && opensPicker(e)) {
            e.preventDefault();
            trigger.current?.click();
        } else if (e.key === 'Escape' && hasDraft) {
            // The first Escape drops the draft; the next one closes the drawer.
            e.stopPropagation();
            e.preventDefault();
            cancel();
        } else if (
            e.key === 'Enter' &&
            (!multiline || e.ctrlKey || e.metaKey)
        ) {
            e.preventDefault();
            commit();
        }
    };

    const controlId = `${id}-control`;
    const errorId = `${id}-error`;
    const stateId = `${id}-state`;
    const describedBy =
        [error ? errorId : null, edit.staged ? stateId : null]
            .filter(Boolean)
            .join(' ') || undefined;
    const textProps = {
        id: controlId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        placeholder: edit.value === null ? 'NULL' : '(empty)',
        value: draft ?? base,
        onChange: (
            e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
        ) => {
            setError(null);
            setDraft(e.target.value);
        },
        onBlur: () => void commit(),
        onKeyDown,
    };
    const control = edit.bool ? (
        <span className="flex items-center gap-2">
            <input
                id={controlId}
                type="checkbox"
                aria-describedby={describedBy}
                className="size-3.5 accent-[var(--universe-accent)]"
                checked={truthy(edit.value)}
                onChange={(e) =>
                    edit.stage(boolValue(edit.dialect, e.target.checked))
                }
            />
            {edit.value === null && (
                <span className="font-mono text-[10px] text-muted-foreground">
                    NULL
                </span>
            )}
        </span>
    ) : multiline ? (
        <textarea
            {...textProps}
            rows={Math.min(10, Math.max(3, base.split('\n').length))}
            className="block w-full resize-y rounded border bg-background px-2 py-1 font-mono text-xs outline-none placeholder:italic focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive"
        />
    ) : (
        <span className="flex items-center gap-1">
            <input
                {...textProps}
                ref={input}
                aria-keyshortcuts={edit.date ? OPEN_PICKER_KEYS : undefined}
                className="block h-7 w-full min-w-0 rounded border bg-background px-2 font-mono text-xs outline-none placeholder:italic focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive"
            />
            {edit.date && (
                <DateEditPopover
                    kind={edit.date}
                    value={draft ?? base}
                    inputRef={input}
                    triggerRef={trigger}
                    // Staged as blur or Enter would stage it; focus returns to the input.
                    onApply={(picked) => {
                        setDraft(undefined);
                        setError(null);
                        edit.stage(picked);
                    }}
                />
            )}
        </span>
    );

    return (
        <div
            data-edited={edit.staged ? 'true' : undefined}
            className={`border-b px-4 py-2 last:border-b-0 ${
                edit.staged ? 'bg-warning/10' : ''
            }`}
        >
            <dt className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-mono font-medium">
                    <label htmlFor={controlId}>{column}</label>{' '}
                    <span className="font-normal text-muted-foreground">
                        {type}
                    </span>
                    {edit.staged && (
                        <span className="ml-1.5 rounded bg-warning/20 px-1 font-sans text-[10px] font-normal text-warning-foreground">
                            edited
                        </span>
                    )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                    {edit.value !== null && (
                        <button
                            type="button"
                            aria-label={`Set ${column} to NULL`}
                            title="Set NULL"
                            className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                            onClick={() => {
                                cancel();
                                edit.stage(null);
                            }}
                        >
                            NULL
                        </button>
                    )}
                    {edit.staged && (
                        <button
                            type="button"
                            aria-label={`Revert ${column}`}
                            title="Revert change"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => {
                                cancel();
                                edit.revert();
                            }}
                        >
                            <Undo2 className="size-3" />
                        </button>
                    )}
                    {edit.value !== null && (
                        <button
                            type="button"
                            aria-label={`Copy ${column}`}
                            title={`Copy ${column}`}
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() =>
                                void writeClipboard(cellText(edit.value))
                            }
                        >
                            <Copy className="size-3" />
                        </button>
                    )}
                </span>
            </dt>
            <dd className="mt-1 text-xs">{control}</dd>
            {error && (
                <p
                    id={errorId}
                    role="alert"
                    className="mt-1 text-[11px] text-destructive"
                >
                    {error}
                </p>
            )}
            {edit.staged && (
                <p
                    id={stateId}
                    className="mt-1 truncate text-[11px] text-muted-foreground"
                    title={shownText(edit.original)}
                >
                    {`Original: ${shownText(edit.original)}`}
                </p>
            )}
        </div>
    );
}

const isTextControl = (el: EventTarget | null) =>
    el instanceof HTMLElement &&
    (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));

export function RowDrawer({
    connectionId,
    snapshot,
    table,
    columns,
    row,
    rowNumber,
    motion = 'open',
    onClose,
    onStep,
    onOpenTable,
    onExplore,
    editing,
    rowIndex,
    readOnly = false,
}: Props) {
    const heading = useRef<HTMLHeadingElement>(null);

    const baseTarget = useMemo(
        () => rowRecordTarget(snapshot, columns, row),
        [snapshot, columns, row],
    );
    const [stack, setStack] = useState<RecordTarget[]>([]);
    // The heading takes focus on open and after every hop or Back: the reference that was clicked
    // and the Back button both unmount, and focus on <body> would leave Escape unable to close.
    useEffect(() => heading.current?.focus(), [stack.length]);
    const current = stack.length > 0 ? stack[stack.length - 1] : baseTarget;
    const currentId = current ? targetId(current) : null;
    const hopped = stack.length > 0;

    const [loaded, setLoaded] = useState<Loaded>(null);
    const [failed, setFailed] = useState<{ id: string; message: string }>();
    const [hopError, setHopError] = useState<string | null>(null);
    const hopRequest = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!current || !currentId) return;
        const controller = new AbortController();
        recordsApi
            .show(connectionId, current.table, current.key, controller.signal)
            .then((payload) => {
                if (controller.signal.aborted) return;
                setLoaded({ id: currentId, payload });
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                setFailed({ id: currentId, message: 'Could not load record.' });
            });
        return () => controller.abort();
        // `current` is derived from `currentId`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connectionId, currentId]);
    useEffect(() => () => hopRequest.current?.abort(), []);

    const payload = loaded?.id === currentId ? loaded.payload : null;
    const loadError = failed?.id === currentId ? failed.message : null;

    // Values on screen: the grid row at the base, the fetched record after a hop.
    const shownColumns: QueryColumn[] = useMemo(
        () =>
            hopped
                ? (payload?.columns ?? []).map((c) => ({
                      ...c,
                      table: current?.table ?? '',
                  }))
                : columns,
        [hopped, payload, columns, current],
    );
    const shownValues = hopped ? (payload?.values ?? []) : row;

    const valueOf = (column: string): QueryCell => {
        const i = shownColumns.findIndex((c) => c.name === column);
        return i < 0 ? null : (shownValues[i] ?? null);
    };

    // Editing (spec §4.2): the grid's row only, never a record reached by a hop (§5.2).
    const rowEditing =
        !hopped && editing && rowIndex !== undefined ? editing : null;
    const target = useMemo(
        () =>
            editing && rowIndex !== undefined
                ? rowTarget(editing, columns, rowIndex, row)
                : null,
        [editing, columns, rowIndex, row],
    );
    const storeKey = editing
        ? pendingKey(editing.connectionId, editing.table)
        : null;
    const pendingRow = usePending((s) =>
        storeKey && target ? s.byTable[storeKey]?.[target.ref] : undefined,
    );
    const rowLock =
        rowEditing && !target ? (rowEditing.rowReason ?? UNPINNED_ROW) : null;
    const rowEditable = !!rowEditing && !!target;
    const deleted = pendingRow?.kind === 'delete';

    /** Drafts open in this drawer's fields: staged before the drawer steps to another row. */
    const drafts = useRef(new Set<() => boolean>());
    const register = useCallback((flush: () => boolean) => {
        drafts.current.add(flush);
        const off = registerEditFlush(flush);
        return () => {
            drafts.current.delete(flush);
            off();
        };
    }, []);
    const flushDrafts = () =>
        [...drafts.current].map((flush) => flush()).every(Boolean);

    const fieldEdit = (index: number): FieldEdit | null => {
        if (!rowEditing || !target || deleted) return null;
        const column = columns[index];
        const name = column.name;
        const update = pendingRow?.kind === 'update' ? pendingRow : null;
        const staged = !!update && name in update.values;
        const loaded = row[index] ?? null;
        const type = columnType(rowEditing, column);
        const { connectionId, table: tableName } = rowEditing;
        return {
            value: update && staged ? update.values[name] : loaded,
            original:
                update && name in update.original
                    ? update.original[name]
                    : loaded,
            staged,
            json: isJsonType(type),
            bool: isBooleanType(type),
            date: dateKind({ type_name: type ?? '' }),
            dialect: rowEditing.dialect,
            stage: (next) =>
                usePending
                    .getState()
                    .setCell(connectionId, tableName, target, name, next),
            revert: () =>
                usePending
                    .getState()
                    .revertCell(connectionId, tableName, target.ref, name),
            register,
        };
    };
    /** Why a field of the editable row can't be edited: the grid's reasons, or line ends an editor can't keep. */
    const fieldLock = (index: number): string | null =>
        rowEditing && target && rowIndex !== undefined && !deleted
            ? (lockedFor(rowEditing, columns, rowIndex, row, index) ??
              lineEndProblem(fieldEdit(index)?.value))
            : null;

    const deleteRow = () => {
        if (!rowEditing || !target) return;
        flushDrafts();
        usePending
            .getState()
            .markDelete(rowEditing.connectionId, rowEditing.table, target);
    };
    const restoreRow = () => {
        if (rowEditing && target)
            usePending
                .getState()
                .unmarkDelete(
                    rowEditing.connectionId,
                    rowEditing.table,
                    target.ref,
                );
    };
    const revertRow = () => {
        if (rowEditing && target)
            usePending
                .getState()
                .revertRow(
                    rowEditing.connectionId,
                    rowEditing.table,
                    target.ref,
                );
    };
    /** Opens the hopped record's table filtered to it, on every key column (a composite key too). */
    const openToEdit = () => {
        if (!current) return;
        onOpenTable(
            current.table,
            Object.entries(current.key).map(([column, value]) => ({
                column,
                op: 'eq' as const,
                value: String(value),
            })),
        );
    };

    const title = current
        ? `${current.table} · ${keyDisplay(current.key)}`
        : `${table.name} · row ${rowNumber ?? ''}`.trim();

    const hop = (rel: RelationshipSummary) => {
        if (!current) return;
        hopRequest.current?.abort();
        const controller = new AbortController();
        hopRequest.current = controller;
        setHopError(null);
        recordsApi
            .related(
                connectionId,
                current.table,
                current.key,
                { rel: rel.id, dir: 'out', limit: 1 },
                controller.signal,
            )
            .then((res) => {
                if (controller.signal.aborted) return;
                const first = res.rows[0];
                if (!first) {
                    setHopError('The referenced record was not found.');
                    return;
                }
                setStack((s) => [...s, { table: res.table, key: first.key }]);
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                setHopError('Could not load the referenced record.');
            });
    };

    const referencingValues = (rel: RelationshipSummary) => {
        const found = snapshot.relationships.find((r) => r.id === rel.id);
        if (!found) return null;
        const cells: CellValue[] = found.to_columns.map(valueOf);
        // Filters take text: convert like the grid does, and skip values a filter cannot match (JSON, blobs).
        if (
            cells.some(
                (v) =>
                    v === null ||
                    v === undefined ||
                    typeof v === 'object' ||
                    cellKind(v, null) === 'binary',
            )
        )
            return null;
        return { found, values: cells.map(cellText) };
    };

    const openReferencing = (rel: RelationshipSummary) => {
        const resolved = referencingValues(rel);
        if (!resolved) return;
        onOpenTable(
            rel.table,
            resolved.found.from_columns.map((c, i) => ({
                column: c,
                op: 'eq' as const,
                value: resolved.values[i],
            })),
        );
    };

    const copyRow = useCallback(
        () => void writeClipboard(toJSON(shownColumns, [shownValues])),
        [shownColumns, shownValues],
    );

    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            onClose();
        } else if (
            (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
            !isTextControl(e.target)
        ) {
            e.preventDefault();
            // A draft is staged before the drawer moves on; an invalid one keeps it here.
            if (flushDrafts()) onStep(e.key === 'ArrowDown' ? 1 : -1);
        }
    };

    const relationships = payload?.relationships ?? [];
    const references = relationships.filter(
        (r) => r.direction === 'out' && r.available,
    );
    const referencedBy = relationships.filter(
        (r) =>
            r.direction === 'in' &&
            r.available &&
            snapshot.relationships.some((s) => s.id === r.id),
    );
    const keyed =
        !!current && explorableTable(snapshot, current.table) !== null;

    return (
        <aside
            role="complementary"
            aria-label="Row details"
            data-motion={motion}
            className={ASIDE}
            onKeyDown={onKeyDown}
        >
            <header className="row-drawer-header flex items-center gap-1 border-b px-2 py-2">
                {hopped && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label="Back"
                        onClick={() => {
                            hopRequest.current?.abort();
                            setHopError(null);
                            setStack((s) => s.slice(0, -1));
                        }}
                    >
                        <ArrowLeft className="size-4" />
                    </Button>
                )}
                <h3
                    ref={heading}
                    tabIndex={-1}
                    className="min-w-0 flex-1 truncate px-2 font-mono text-sm font-medium outline-none"
                >
                    {title}
                </h3>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Copy row as JSON"
                    title="Copy row as JSON"
                    disabled={hopped && !payload}
                    onClick={copyRow}
                >
                    <Copy className="size-4" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Close row details"
                    onClick={onClose}
                >
                    <X className="size-4" />
                </Button>
            </header>
            {rowEditable && (
                <div
                    role="toolbar"
                    aria-label="Row actions"
                    className="flex items-center gap-1 border-b px-2 py-1 text-xs"
                >
                    <span
                        className={`min-w-0 flex-1 truncate px-2 ${
                            deleted
                                ? 'font-medium text-destructive'
                                : pendingRow
                                  ? 'font-medium text-warning-foreground'
                                  : 'text-muted-foreground'
                        }`}
                    >
                        {deleted
                            ? 'Deleted'
                            : pendingRow
                              ? 'Edited'
                              : 'Editable'}
                    </span>
                    {pendingRow?.kind === 'update' && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={revertRow}
                        >
                            <RotateCcw className="size-3.5" /> Revert row
                        </Button>
                    )}
                    {deleted ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={restoreRow}
                        >
                            <Undo2 className="size-3.5" /> Restore row
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={deleteRow}
                        >
                            <Trash2 className="size-3.5" /> Delete row
                        </Button>
                    )}
                </div>
            )}
            {rowLock && (
                <p className="border-b px-4 py-2 text-xs text-muted-foreground">
                    {`Not editable: ${rowLock}`}
                </p>
            )}
            {hopped && payload && (
                <div className="flex items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
                    <span className="min-w-0 flex-1">
                        Read-only here: a related record.
                    </span>
                    {!readOnly && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={openToEdit}
                        >
                            <PencilLine className="size-3.5" /> Open to edit
                        </Button>
                    )}
                </div>
            )}
            <div className="row-drawer-body min-h-0 flex-1 overflow-y-auto">
                {hopped && !payload ? (
                    <p
                        role={loadError ? 'alert' : undefined}
                        className="px-4 py-3 text-xs text-muted-foreground"
                    >
                        {loadError ?? 'Loading record…'}
                    </p>
                ) : (
                    <dl>
                        {shownColumns.map((c, i) => {
                            const lock = fieldLock(i);
                            const edit = lock ? null : fieldEdit(i);
                            return edit ? (
                                <EditableField
                                    key={`${c.name}:${i}`}
                                    column={c.name}
                                    type={c.type ?? ''}
                                    edit={edit}
                                />
                            ) : (
                                <Field
                                    key={`${c.name}:${i}`}
                                    column={c.name}
                                    type={c.type ?? ''}
                                    value={shownValues[i] ?? null}
                                    lock={lock}
                                />
                            );
                        })}
                    </dl>
                )}
                {keyed ? (
                    <section className="border-t px-4 py-3 text-xs">
                        {loadError && !hopped && (
                            <p role="alert" className="text-destructive">
                                {loadError}
                            </p>
                        )}
                        {!payload && !loadError && (
                            <p className="text-muted-foreground">
                                Loading relations…
                            </p>
                        )}
                        {hopError && (
                            <p role="alert" className="text-destructive">
                                {hopError}
                            </p>
                        )}
                        {references.length > 0 && (
                            <div className="mb-3">
                                <h4 className="mb-1 font-medium">References</h4>
                                <ul className="flex flex-col gap-1">
                                    {references.map((r) => (
                                        <li key={r.id}>
                                            <button
                                                type="button"
                                                className="text-left underline hover:text-foreground"
                                                onClick={() => hop(r)}
                                            >
                                                {`${r.table} · ${r.columns.join(', ')}`}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {referencedBy.length > 0 && (
                            <div className="mb-3">
                                <h4 className="mb-1 font-medium">
                                    Referenced by
                                </h4>
                                <ul className="flex flex-col gap-1">
                                    {referencedBy.map((r) => (
                                        <li key={r.id}>
                                            <button
                                                type="button"
                                                disabled={!referencingValues(r)}
                                                className="text-left underline hover:text-foreground disabled:no-underline disabled:opacity-60"
                                                onClick={() =>
                                                    openReferencing(r)
                                                }
                                            >
                                                {r.count
                                                    ? `${r.table} (${r.count.value}${r.count.capped ? '+' : ''})`
                                                    : r.table}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {current && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onExplore(current)}
                            >
                                <Network className="size-3.5" /> Explore graph
                            </Button>
                        )}
                    </section>
                ) : (
                    <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                        Relations are available for tables with a primary key.
                    </p>
                )}
            </div>
        </aside>
    );
}
