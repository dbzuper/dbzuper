import { ArrowLeft, Copy, Network, X } from 'lucide-react';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { blobLabel, cellKind, cellText, type CellValue } from '@/grid/cells';
import { toJSON, writeClipboard } from '@/grid/copy';
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

type Props = {
    connectionId: number;
    snapshot: SchemaSnapshot;
    table: TableSchema;
    columns: QueryColumn[];
    row: QueryCell[];
    /** 1-based position of the row in the table, shown for rows without a key. */
    rowNumber?: number;
    onClose: () => void;
    onStep: (dir: 1 | -1) => void;
    onOpenTable: (table: string, filters: RowFilter[]) => void;
    onExplore: (target: RecordTarget) => void;
};

type Loaded = { id: string; payload: RecordPayload } | null;

const COLLAPSED_LINES = 6;
const LONG_TEXT = 300;

const targetId = (t: RecordTarget) => `${t.table}:${JSON.stringify(t.key)}`;

const ASIDE =
    'flex h-full w-[420px] max-w-full shrink-0 flex-col border-l bg-background';

/** Held in the drawer's place while the page holding the row loads. */
export function RowDrawerLoading() {
    return (
        <aside
            role="complementary"
            aria-label="Row details"
            aria-busy="true"
            className={ASIDE}
        >
            <p className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                <Spinner className="size-3" /> Loading row…
            </p>
        </aside>
    );
}

function prettyJson(value: CellValue): string {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return JSON.stringify(parsed, null, 2);
    } catch {
        return cellText(value);
    }
}

function Field({
    column,
    type,
    value,
}: {
    column: string;
    type: string;
    value: CellValue;
}) {
    const [expanded, setExpanded] = useState(false);
    const kind = cellKind(value, type);
    const text =
        kind === 'json'
            ? prettyJson(value)
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
    onClose,
    onStep,
    onOpenTable,
    onExplore,
}: Props) {
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => heading.current?.focus(), []);

    const baseTarget = useMemo(
        () => rowRecordTarget(snapshot, columns, row),
        [snapshot, columns, row],
    );
    const [stack, setStack] = useState<RecordTarget[]>([]);
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

    const openReferencing = (rel: RelationshipSummary) => {
        const found = snapshot.relationships.find((r) => r.id === rel.id);
        if (!found) return;
        onOpenTable(
            rel.table,
            found.from_columns.map((c, i) => ({
                column: c,
                op: 'eq' as const,
                value: String(valueOf(found.to_columns[i])),
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
            onStep(e.key === 'ArrowDown' ? 1 : -1);
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
            className={ASIDE}
            onKeyDown={onKeyDown}
        >
            <header className="flex items-center gap-1 border-b px-2 py-2">
                {hopped && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label="Back"
                        onClick={() => setStack((s) => s.slice(0, -1))}
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
            <div className="min-h-0 flex-1 overflow-y-auto">
                {hopped && !payload ? (
                    <p
                        role={loadError ? 'alert' : undefined}
                        className="px-4 py-3 text-xs text-muted-foreground"
                    >
                        {loadError ?? 'Loading record…'}
                    </p>
                ) : (
                    <dl>
                        {shownColumns.map((c, i) => (
                            <Field
                                key={`${c.name}:${i}`}
                                column={c.name}
                                type={c.type ?? ''}
                                value={shownValues[i] ?? null}
                            />
                        ))}
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
                                                className="text-left underline hover:text-foreground"
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
