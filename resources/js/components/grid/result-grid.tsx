import 'react-data-grid/lib/styles.css';
import {
    DataGrid,
    SelectColumn,
    renderHeaderCell as defaultHeaderCell,
    type Column,
    type DataGridHandle,
    type RenderEditCellProps,
    type SortColumn,
} from 'react-data-grid';
import { ChevronRight, ExternalLink, Filter } from 'lucide-react';
import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { toast } from 'sonner';
import {
    blobLabel,
    cellKind,
    cellText,
    cellTitle,
    fkTarget,
    isEmptyString,
    isLong,
    type CellValue,
} from '@/grid/cells';
import {
    foreignRecordTarget,
    keyDisplay,
    rowRecordTarget,
    type RecordTarget,
} from '@/records/open-record';
import { sortRows } from '@/grid/sort';
import type { GridLayout } from '@/browse/local-prefs';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import {
    rowRefs,
    usePending,
    type PendingRow,
    type PendingTarget,
    type RowRef,
} from '@/editing/pending-store';
import { registerEditFlush } from '@/editing/flush-edits';
import {
    boolValue as boolValue_,
    committedValue,
    isBinaryType,
    isBooleanType,
    isJsonType,
    jsonError,
    lockedFor as lockedFor_,
    rowTarget,
    shownText,
    truthy,
    type GridEditing,
} from '@/editing/row-edit';
import { dateKind } from '@/lib/date-filter';
import { cn } from '@/lib/utils';
import type {
    Dialect,
    QueryCell,
    QueryColumn,
    SchemaSnapshot,
} from '@/types/schema';
import { CellDrawer, type DrawerState } from './cell-drawer';
import { BoolCellEditor, TextCellEditor } from './cell-editors';
import { RowMenu } from './row-menu';
import { SelectionBar } from './selection-bar';

/**
 * One grid row. `__i` is the row's index in `rows` (negative for new, not yet inserted rows, shown first); `ref` keys
 * its pending change; `draft` is the inline editor's value until the grid commits it.
 */
type Row = {
    __i: number;
    cells: QueryCell[];
    ref: RowRef | null;
    draft?: { column: string; value: string | null };
};

export type { GridEditing } from '@/editing/row-edit';

/** Keeps an open inline editor flushable: Review & commit stages its draft before previewing. */
function EditFlush({
    onClose,
    children,
}: {
    onClose: (commitChanges?: boolean, shouldFocus?: boolean) => void;
    children: ReactNode;
}) {
    const close = useRef(onClose);
    useLayoutEffect(() => {
        close.current = onClose;
    });
    useEffect(() => registerEditFlush(() => close.current(true, false)), []);
    return children;
}

const NO_PENDING: Record<RowRef, PendingRow> = {};
const NO_ERRORS: Record<RowRef, string> = {};

type Props = {
    columns: QueryColumn[];
    rows: QueryCell[][];
    snapshot?: SchemaSnapshot | null;
    onOpenForeign?: (table: string, column: string, value: string) => void;
    /**
     * Opens a record. FK cells use it when the relationship targets the parent's whole key (else
     * onOpenForeign), and a leading "Open record" button appears on each row that maps to a record of one explorable table.
     */
    onOpenRecord?: (target: RecordTarget) => void;
    /** Server-side sorting (table tabs); when omitted the grid sorts the fetched rows client-side. */
    sort?: {
        columns: SortColumn[];
        onChange: (columns: SortColumn[]) => void;
        /** Sort keys kept (Ctrl/Cmd+click adds one); the oldest drops beyond it. Default 1. */
        maxKeys?: number;
    };
    /** Column widths and hidden columns, by column name. */
    layout?: { value: GridLayout; onChange: (next: GridLayout) => void };
    /** Adds a filter button to each header; called with the column name. */
    onFilterColumn?: (column: string) => void;
    /** Enter on a cell, the row button, or "Open row" in the row menu. */
    onOpenRow?: (rowIndex: number) => void;
    /** Closes the open row: its row button toggles (a second click closes it). */
    onCloseRow?: () => void;
    /** Highlights this row (the drawer's row). */
    activeRow?: number | null;
    /** Enables row checkboxes and the copy menu (Copy as JSON / INSERT / CSV). */
    rowMenu?: { dialect: Dialect; table: string };
    /** Restores and reports the vertical scroll offset. */
    scrollTop?: number;
    onScrollTopChange?: (top: number) => void;
    /** Inline editing staged into the pending-changes store; table tabs only (never SQL results). */
    editing?: GridEditing;
};

const MAX_WIDTH = 480;
const RESIZE_DEBOUNCE_MS = 200;

const PREVIEW_CHARS = 120;

export function CellView({
    value,
    type,
    onOpen,
    foreign,
    title,
}: {
    value: CellValue;
    type: string | null;
    onOpen: () => void;
    foreign?: { label: string; onClick: () => void } | null;
    /** Replaces the value tooltip (an edited cell shows its original, a locked one why). */
    title?: string;
}) {
    const kind = cellKind(value, type);
    if (kind === 'null')
        return (
            <span data-null="true" className="text-muted-foreground italic">
                NULL
            </span>
        );
    if (isEmptyString(value))
        return (
            <span
                data-empty="true"
                className="block h-full min-w-4 bg-muted/40"
            />
        );
    const textValue = cellText(value);
    const expandable = kind === 'json' || isLong(value);
    const preview = expandable
        ? Array.from(textValue)
              .slice(0, PREVIEW_CHARS)
              .join('')
              .replace(/\s*\n\s*/g, ' ')
        : textValue;
    const body = foreign ? (
        <button
            type="button"
            aria-label={foreign.label}
            onClick={foreign.onClick}
            className="text-[var(--universe-accent)] underline-offset-2 hover:underline"
        >
            {textValue}
        </button>
    ) : (
        <span
            data-kind={kind}
            title={
                title ??
                (kind === 'boolean' || kind === 'binary'
                    ? undefined
                    : cellTitle(textValue))
            }
            role={kind === 'boolean' ? 'img' : undefined}
            aria-label={kind === 'boolean' ? textValue : undefined}
            className={cn(
                kind === 'number' && 'block text-right tabular-nums',
                kind === 'binary' && 'text-muted-foreground italic',
                kind === 'boolean' && 'text-[var(--universe-accent)]',
            )}
        >
            {kind === 'boolean'
                ? value
                    ? '✓'
                    : '✗'
                : kind === 'binary'
                  ? blobLabel(value)
                  : preview}
        </span>
    );
    return (
        <span className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate">{body}</span>
            {expandable && (
                <button
                    type="button"
                    onClick={onOpen}
                    className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                    View
                </button>
            )}
        </span>
    );
}

const initialOrder = (columns: QueryColumn[]) =>
    columns.map((_, i) => String(i));

/** What the grid needs to stage edits: per-row targets, staged values and why a cell is locked. */
function editModel(
    editing: GridEditing,
    columns: QueryColumn[],
    rows: QueryCell[][],
    pending: Record<RowRef, PendingRow>,
) {
    const refs = rowRefs(editing.rowIds);
    const schema = new Map(editing.tableColumns.map((c) => [c.name, c]));
    const typeOf = (index: number) =>
        schema.get(columns[index].name)?.type_name ?? columns[index].type;
    const readOnly = new Set(editing.readOnlyColumns);
    const pendingOf = (row: Row) => (row.ref ? pending[row.ref] : undefined);

    const target = (row: Row): PendingTarget | null => {
        if (!row.ref) return null;
        if (row.__i < 0) return { ref: row.ref, id: null, original: {} };
        const cells = rows[row.__i];
        // The editor's copy of a row may predate the rows on screen: never stage it on another row.
        if (!cells || refs[row.__i] !== row.ref) return null;
        return rowTarget(editing, columns, row.__i, cells);
    };

    /** The value the cell shows: staged, else loaded. */
    const shown = (row: Row, index: number): QueryCell | undefined => {
        const p = pendingOf(row);
        const name = columns[index].name;
        if (p && p.kind !== 'delete' && name in p.values) return p.values[name];
        return row.__i < 0 ? undefined : rows[row.__i]?.[index];
    };

    /** Why the cell can't be edited inline (the tooltip text), or null when it can. */
    const lockReason = (row: Row, index: number): string | null => {
        const reason = lockedFor(row, index);
        if (reason) return `Not editable: ${reason}`;
        const value = shown(row, index);
        // An <input> drops line breaks: editing would silently join the lines.
        if (typeof value === 'string' && /[\r\n]/.test(value))
            return 'Multi-line value: edit it in the row drawer';
        return null;
    };

    const lockedFor = (row: Row, index: number): string | null => {
        if (row.__i >= 0)
            return lockedFor_(editing, columns, row.__i, rows[row.__i], index);
        if (isBinaryType(typeOf(index))) return 'binary';
        return readOnly.has(columns[index].name) ? 'generated column' : null;
    };

    const editable = (row: Row, index: number) =>
        pendingOf(row)?.kind !== 'delete' && lockReason(row, index) === null;

    /** Whether the cell holds a staged value (not its loaded or default one). */
    const staged = (row: Row, index: number) => {
        const p = pendingOf(row);
        return !!p && p.kind !== 'delete' && columns[index].name in p.values;
    };

    /** A new row's column that is NOT NULL without a default and still has no value. */
    const required = (row: Row, index: number) => {
        const p = pendingOf(row);
        const column = schema.get(columns[index].name);
        return (
            p?.kind === 'insert' &&
            !(columns[index].name in p.values) &&
            !!column &&
            !column.nullable &&
            column.default === null &&
            !column.auto_increment &&
            !readOnly.has(column.name)
        );
    };

    /** The value a staged edit replaced: the original stored with the change. */
    const originalOf = (row: Row, index: number): QueryCell | undefined => {
        const p = pendingOf(row);
        const name = columns[index].name;
        return p && p.kind !== 'insert' && name in p.original
            ? p.original[name]
            : rows[row.__i]?.[index];
    };

    const boolValue = (on: boolean) => boolValue_(editing.dialect, on);

    return {
        refs,
        typeOf,
        pendingOf,
        target,
        lockReason,
        originalOf,
        editable,
        staged,
        required,
        boolValue,
        isBool: (index: number) => isBooleanType(typeOf(index)),
        isJson: (index: number) => isJsonType(typeOf(index)),
        dateKind: (index: number) =>
            dateKind({ type_name: typeOf(index) ?? '' }),
        /** What committing `text` in column `index` stages, or why it can't (an emptied NOT NULL column). */
        committed: (index: number, text: string | null) =>
            committedValue(editing, columns[index].name, text),
    };
}

export function ResultGrid({
    columns,
    rows,
    snapshot = null,
    onOpenForeign,
    onOpenRecord,
    sort,
    layout,
    onFilterColumn,
    onOpenRow,
    onCloseRow,
    activeRow = null,
    rowMenu,
    scrollTop,
    onScrollTopChange,
    editing,
}: Props) {
    const [colState, setLayout] = useState(() => ({
        columns,
        order: initialOrder(columns),
    }));
    const [selection, setSelection] = useState<{
        rows: QueryCell[][];
        selected: ReadonlySet<number>;
    }>({ rows, selected: new Set() });
    const [menuRow, setMenuRow] = useState<number | null>(null);
    /** The data column (index into `columns`) the context menu was opened on. */
    const [menuColumn, setMenuColumn] = useState<number | null>(null);
    const gridRef = useRef<DataGridHandle>(null);
    const [localSort, setLocalSort] = useState<SortColumn[]>([]);
    const [drawer, setDrawer] = useState<DrawerState>(null);

    // A new result set invalidates the column order and the client-side sort.
    let order = colState.order;
    if (colState.columns !== columns) {
        order = initialOrder(columns);
        setLayout({ columns, order });
        setLocalSort([]);
    }
    // Row selection belongs to one result set.
    let selected = selection.selected;
    if (selection.rows !== rows) {
        selected = new Set();
        setSelection({ rows, selected });
        setMenuRow(null);
    }

    const layoutRef = useRef(layout);
    useEffect(() => {
        layoutRef.current = layout;
    });
    const pendingWidths = useRef<Record<string, number>>({});
    const resizeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
    );
    const flushWidths = () => {
        clearTimeout(resizeTimer.current);
        const current = layoutRef.current;
        if (!current || Object.keys(pendingWidths.current).length === 0) return;
        const widths = pendingWidths.current;
        pendingWidths.current = {};
        current.onChange({
            ...current.value,
            widths: { ...current.value.widths, ...widths },
        });
    };
    const flushRef = useRef(flushWidths);
    useEffect(() => {
        flushRef.current = flushWidths;
    });
    useEffect(() => () => flushRef.current(), []);
    const onColumnResize = (column: { name: unknown }, width: number) => {
        if (!layoutRef.current || typeof column.name !== 'string') return;
        pendingWidths.current[column.name] = Math.min(
            MAX_WIDTH,
            Math.round(width),
        );
        clearTimeout(resizeTimer.current);
        resizeTimer.current = setTimeout(flushWidths, RESIZE_DEBOUNCE_MS);
    };

    useEffect(() => {
        const element = gridRef.current?.element;
        if (element && scrollTop) element.scrollTop = scrollTop;
        // Restores once, on mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const frame = useRef<number | null>(null);
    useEffect(
        () => () => {
            if (frame.current !== null) cancelAnimationFrame(frame.current);
        },
        [],
    );

    const pendingKey = editing
        ? `${editing.connectionId}:${editing.table}`
        : null;
    const pending = usePending((s) =>
        pendingKey ? (s.byTable[pendingKey] ?? NO_PENDING) : NO_PENDING,
    );
    // Why a row's change failed in the last commit: a red outline, and the error on its marker (spec §4.1).
    const rowErrors = usePending((s) =>
        pendingKey ? (s.errors[pendingKey] ?? NO_ERRORS) : NO_ERRORS,
    );
    const model = useMemo(
        () => (editing ? editModel(editing, columns, rows, pending) : null),
        [editing, columns, rows, pending],
    );

    // Stable negative keys for new rows, newest most negative; given once per ref, never reused.
    const [keyState, setKeyState] = useState<{
        keys: Record<RowRef, number>;
        next: number;
    }>({ keys: {}, next: -1 });
    let newKeys = keyState;
    const unkeyed = Object.values(pending).filter(
        (p) => p.kind === 'insert' && !(p.ref in keyState.keys),
    );
    if (unkeyed.length > 0) {
        const keys = { ...keyState.keys };
        let next = keyState.next;
        for (const p of unkeyed) keys[p.ref] = next--;
        newKeys = { keys, next };
        setKeyState(newKeys);
    }

    const sortColumns = sort?.columns ?? localSort;
    const data: Row[] = useMemo(() => {
        // Editable rows are indexed by their position in `rows`, so they are never sorted here.
        const active = sort || model ? undefined : localSort[0];
        const sorted = active
            ? sortRows(rows, Number(active.columnKey), active.direction)
            : rows;
        const loaded = sorted.map((cells, i): Row => {
            const ref = model?.refs[i] ?? null;
            const p = ref ? pending[ref] : undefined;
            return {
                __i: i,
                ref,
                cells:
                    p?.kind === 'update'
                        ? cells.map((cell, c) =>
                              columns[c] && columns[c].name in p.values
                                  ? p.values[columns[c].name]
                                  : cell,
                          )
                        : cells,
            };
        });
        if (!model) return loaded;
        // New rows first, newest on top. Each keeps the key it was given while others come and go, so a
        // selection never moves to another new row.
        const added = Object.values(pending)
            .filter(
                (p): p is Extract<PendingRow, { kind: 'insert' }> =>
                    p.kind === 'insert',
            )
            .flatMap((p): Row[] => {
                const key = newKeys.keys[p.ref];
                return key === undefined
                    ? []
                    : [
                          {
                              __i: key,
                              ref: p.ref,
                              cells: columns.map(
                                  (c) => p.values[c.name] ?? null,
                              ),
                          },
                      ];
            })
            .sort((a, b) => a.__i - b.__i);
        return [...added, ...loaded];
    }, [rows, localSort, sort, model, pending, columns, newKeys]);
    const rowByIndex = useMemo(
        () => new Map(data.map((r) => [r.__i, r])),
        [data],
    );

    // The column shows when any row stands for a record; each row then decides for itself
    // (a row with a NULL key has nothing to open).
    const rowActions = useMemo(
        () =>
            !!(
                snapshot &&
                onOpenRecord &&
                rows.some((row) => rowRecordTarget(snapshot, columns, row))
            ),
        [snapshot, onOpenRecord, columns, rows],
    );

    const gridColumns: Column<Row>[] = useMemo(() => {
        const hidden = new Set(layout?.value.hidden);
        const widths = layout?.value.widths;
        const selectColumn: Column<Row>[] = rowMenu ? [SelectColumn] : [];
        // The pending-change mark (•, +, −, ! on a failed commit), with its label for screen readers.
        const marker = (row: Row) => {
            const p = model?.pendingOf(row);
            if (!p) return null;
            const [mark, label] =
                p.kind === 'insert'
                    ? ['+', 'new row']
                    : p.kind === 'delete'
                      ? ['−', 'deleted']
                      : ['•', 'edited row'];
            const error = row.ref ? rowErrors[row.ref] : undefined;
            return (
                <span
                    title={error ? `${label}: ${error}` : label}
                    data-state={p.kind}
                    className={cn(
                        'block text-center font-semibold',
                        error && 'text-destructive',
                    )}
                >
                    <span aria-hidden="true">{error ? '!' : mark}</span>
                    <span className="sr-only">
                        {error ? `${label}, failed: ${error}` : label}
                    </span>
                </span>
            );
        };
        // Next to the row button the mark shares its cell; a grid without one gives it its own column.
        const stateColumn: Column<Row>[] =
            model && !onOpenRow
                ? [
                      {
                          key: '__state',
                          name: '',
                          width: 28,
                          minWidth: 28,
                          maxWidth: 28,
                          frozen: true,
                          resizable: false,
                          sortable: false,
                          draggable: false,
                          renderHeaderCell: () => (
                              <span className="sr-only">Pending change</span>
                          ),
                          renderCell: ({ row }) => marker(row),
                      },
                  ]
                : [];
        const rowButtonWidth = model ? 48 : 36;
        const rowButton: Column<Row>[] = onOpenRow
            ? [
                  {
                      key: '__open',
                      name: '',
                      width: rowButtonWidth,
                      minWidth: rowButtonWidth,
                      maxWidth: rowButtonWidth,
                      frozen: true,
                      resizable: false,
                      sortable: false,
                      draggable: false,
                      // The whole cell is the click target, not just the icon: the button fills the rest of the
                      // cell, and a click on the pending mark beside it does the same (the mark keeps its tooltip).
                      cellClass: 'rdg-row-button-cell',
                      renderCell: ({ row }) => {
                          const open = row.__i === activeRow;
                          const toggle = () =>
                              open && onCloseRow
                                  ? onCloseRow()
                                  : onOpenRow(row.__i);
                          return (
                              <span
                                  className={cn(
                                      'group flex h-full items-center',
                                      row.__i >= 0 &&
                                          'cursor-pointer hover:bg-muted',
                                  )}
                                  onClick={
                                      row.__i < 0
                                          ? undefined
                                          : (e) => {
                                                if (
                                                    !(
                                                        e.target as HTMLElement
                                                    ).closest('button')
                                                )
                                                    toggle();
                                            }
                                  }
                              >
                                  {model && (
                                      <span className="w-3 shrink-0 pl-1">
                                          {marker(row)}
                                      </span>
                                  )}
                                  {row.__i < 0 ? null : (
                                      <button
                                          type="button"
                                          aria-label="Open row"
                                          aria-expanded={open}
                                          title={
                                              open && onCloseRow
                                                  ? 'Close row'
                                                  : 'Open row'
                                          }
                                          data-row-index={row.__i}
                                          onClick={toggle}
                                          className={cn(
                                              'flex h-full min-w-0 flex-1 items-center justify-center text-muted-foreground group-hover:text-[var(--universe-accent)] focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none focus-visible:ring-inset',
                                              open &&
                                                  'text-[var(--universe-accent)]',
                                          )}
                                      >
                                          <ChevronRight className="size-3.5" />
                                      </button>
                                  )}
                              </span>
                          );
                      },
                  },
              ]
            : [];
        const openColumn: Column<Row>[] =
            !onOpenRow && rowActions && snapshot && onOpenRecord
                ? [
                      {
                          key: '__open',
                          name: '',
                          width: 36,
                          minWidth: 36,
                          maxWidth: 36,
                          frozen: true,
                          resizable: false,
                          sortable: false,
                          draggable: false,
                          renderCell: ({ row }) => {
                              const target = rowRecordTarget(
                                  snapshot,
                                  columns,
                                  row.cells,
                              );
                              if (!target) return null;
                              return (
                                  <button
                                      type="button"
                                      aria-label="Open record"
                                      title="Open record"
                                      onClick={() => onOpenRecord(target)}
                                      className="rounded text-muted-foreground hover:text-[var(--universe-accent)] focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none"
                                  >
                                      <ExternalLink className="size-3.5" />
                                  </button>
                              );
                          },
                      },
                  ]
                : [];
        return [
            ...selectColumn,
            ...stateColumn,
            ...rowButton,
            ...openColumn,
            ...order
                .filter(
                    (key) =>
                        columns[Number(key)] &&
                        !hidden.has(columns[Number(key)].name),
                )
                .map((key): Column<Row> => {
                    const index = Number(key);
                    const column = columns[index];
                    const target = snapshot ? fkTarget(column, snapshot) : null;
                    return {
                        key,
                        name: column.name,
                        resizable: true,
                        sortable: true,
                        draggable: true,
                        minWidth: 60,
                        width: widths?.[column.name],
                        renderHeaderCell: onFilterColumn
                            ? (props) => (
                                  <span className="flex items-center gap-1">
                                      <span className="min-w-0 flex-1 truncate">
                                          {defaultHeaderCell(props)}
                                      </span>
                                      <button
                                          type="button"
                                          aria-label={`Filter ${column.name}`}
                                          title={`Filter ${column.name}`}
                                          onClick={(event) => {
                                              event.stopPropagation();
                                              onFilterColumn(column.name);
                                          }}
                                          onKeyDown={(event) => {
                                              if (
                                                  event.key !== 'Enter' &&
                                                  event.key !== ' '
                                              )
                                                  return;
                                              // The header sorts on Enter and Space; this button filters.
                                              event.stopPropagation();
                                              event.preventDefault();
                                              onFilterColumn(column.name);
                                          }}
                                          className="shrink-0 rounded text-muted-foreground hover:text-[var(--universe-accent)] focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none"
                                      >
                                          <Filter className="size-3" />
                                      </button>
                                  </span>
                              )
                            : undefined,
                        ...(model
                            ? {
                                  editable: (row: Row) =>
                                      model.editable(row, index),
                                  editorOptions: {
                                      closeOnExternalRowChange: false,
                                  },
                                  cellClass: (row: Row) =>
                                      model.staged(row, index) &&
                                      model.pendingOf(row)?.kind === 'update'
                                          ? 'rdg-cell-edited'
                                          : model.required(row, index)
                                            ? 'rdg-cell-required'
                                            : undefined,
                                  renderEditCell: ({
                                      row,
                                      onRowChange,
                                      onClose,
                                  }: RenderEditCellProps<Row>) => {
                                      const draft =
                                          row.draft?.column === column.name
                                              ? row.draft.value
                                              : undefined;
                                      const change = (value: string) =>
                                          onRowChange({
                                              ...row,
                                              draft: {
                                                  column: column.name,
                                                  value,
                                              },
                                          });
                                      if (model.isBool(index))
                                          return (
                                              <EditFlush onClose={onClose}>
                                                  <BoolCellEditor
                                                      label={column.name}
                                                      checked={truthy(
                                                          draft === undefined
                                                              ? row.cells[index]
                                                              : draft,
                                                      )}
                                                      onChange={(on) =>
                                                          change(
                                                              model.boolValue(
                                                                  on,
                                                              ),
                                                          )
                                                      }
                                                  />
                                              </EditFlush>
                                          );
                                      const value = row.cells[index];
                                      const kind = model.dateKind(index);
                                      return (
                                          <EditFlush onClose={onClose}>
                                              <TextCellEditor
                                                  label={column.name}
                                                  initial={
                                                      value === null
                                                          ? ''
                                                          : cellText(value)
                                                  }
                                                  draft={
                                                      typeof draft === 'string'
                                                          ? draft
                                                          : undefined
                                                  }
                                                  onDraft={change}
                                                  json={model.isJson(index)}
                                                  invalid={(text) => {
                                                      const result =
                                                          model.committed(
                                                              index,
                                                              text,
                                                          );
                                                      return 'error' in result
                                                          ? result.error
                                                          : null;
                                                  }}
                                                  date={
                                                      kind
                                                          ? {
                                                                kind,
                                                                // Commits as Enter does: staged, editor closed, cell focused.
                                                                onPick: (
                                                                    picked,
                                                                ) =>
                                                                    onRowChange(
                                                                        {
                                                                            ...row,
                                                                            draft: {
                                                                                column: column.name,
                                                                                value: picked,
                                                                            },
                                                                        },
                                                                        true,
                                                                    ),
                                                            }
                                                          : null
                                                  }
                                              />
                                          </EditFlush>
                                      );
                                  },
                              }
                            : {}),
                        renderCell: ({ row }) => {
                            const value = row.cells[index];
                            if (
                                model?.pendingOf(row)?.kind === 'insert' &&
                                !model.staged(row, index)
                            ) {
                                const required = model.required(row, index);
                                return (
                                    <span
                                        data-default="true"
                                        title={
                                            required
                                                ? 'NOT NULL without a default: give it a value'
                                                : 'Left out of the INSERT: the column default applies'
                                        }
                                        className={cn(
                                            'italic',
                                            required
                                                ? 'font-medium text-destructive'
                                                : 'text-muted-foreground',
                                        )}
                                    >
                                        {required ? 'required' : '(default)'}
                                    </span>
                                );
                            }
                            // The parent record when the cell opens one, else the Data-tab filter.
                            const record =
                                target &&
                                value !== null &&
                                snapshot &&
                                onOpenRecord
                                    ? foreignRecordTarget(
                                          snapshot,
                                          column,
                                          value,
                                      )
                                    : null;
                            const foreign =
                                target &&
                                value !== null &&
                                (onOpenForeign || onOpenRecord)
                                    ? {
                                          label: record
                                              ? `Open record ${record.table} ${keyDisplay(record.key)}`
                                              : `Open ${target.table} where ${target.column} = ${String(value)}`,
                                          onClick: () => {
                                              if (record)
                                                  onOpenRecord?.(record);
                                              else
                                                  onOpenForeign?.(
                                                      target.table,
                                                      target.column,
                                                      String(value),
                                                  );
                                          },
                                      }
                                    : null;
                            const lock =
                                model && row.__i >= 0
                                    ? model.lockReason(row, index)
                                    : null;
                            const edited =
                                !!model &&
                                row.__i >= 0 &&
                                model.pendingOf(row)?.kind === 'update' &&
                                model.staged(row, index);
                            const hint = edited
                                ? `Original: ${shownText(model.originalOf(row, index))}`
                                : (lock ?? undefined);
                            const view = (
                                <CellView
                                    value={value}
                                    type={column.type}
                                    foreign={foreign}
                                    title={hint}
                                    onOpen={() => setDrawer({ column, value })}
                                />
                            );
                            if (edited)
                                return (
                                    <span
                                        data-edited="true"
                                        title={hint}
                                        className="flex h-full items-center gap-1"
                                    >
                                        <span className="min-w-0 flex-1">
                                            {view}
                                        </span>
                                        <span
                                            aria-hidden="true"
                                            className="shrink-0 text-warning-foreground"
                                        >
                                            •
                                        </span>
                                        <span className="sr-only">edited</span>
                                    </span>
                                );
                            if (lock)
                                return (
                                    <span
                                        data-locked="true"
                                        title={hint}
                                        className="block h-full"
                                    >
                                        {view}
                                        <span className="sr-only">{`. ${hint}`}</span>
                                    </span>
                                );
                            return view;
                        },
                    };
                }),
        ];
    }, [
        order,
        columns,
        snapshot,
        onOpenForeign,
        onOpenRecord,
        rowActions,
        layout,
        rowMenu,
        onOpenRow,
        onCloseRow,
        activeRow,
        onFilterColumn,
        model,
        rows,
        rowErrors,
    ]);

    const maxKeys = Math.max(1, sort?.maxKeys ?? 1);
    /** The rows a row action applies to: every selected row when `row` is one of them, else `row` alone. */
    const actionRows = (row: number) =>
        (selected.has(row) ? [...selected].sort((a, b) => a - b) : [row])
            .map((i) => rowByIndex.get(i))
            .filter((r): r is Row => !!r);
    const menuRows = useMemo(() => {
        if (menuRow === null || !rowMenu) return [];
        const indices = selected.has(menuRow)
            ? [...selected].sort((a, b) => a - b)
            : [menuRow];
        // New rows aren't in the table yet: nothing to copy.
        return indices.flatMap((i) => {
            const r = i >= 0 ? rowByIndex.get(i) : undefined;
            return r ? [r.cells] : [];
        });
    }, [menuRow, selected, rowByIndex, rowMenu]);

    const markDelete = (targets: Row[]) => {
        if (!editing || !model) return;
        const store = usePending.getState();
        for (const r of targets) {
            const target = model.target(r);
            if (target)
                store.markDelete(editing.connectionId, editing.table, target);
        }
    };

    const editItems = (() => {
        if (!editing || !model || menuRow === null) return [];
        const row = rowByIndex.get(menuRow);
        if (!row || !model.target(row)) return [];
        const { connectionId, table } = editing;
        const store = usePending.getState();
        const p = model.pendingOf(row);
        if (p?.kind === 'delete')
            return [
                {
                    label: 'Restore row',
                    onSelect: () =>
                        store.unmarkDelete(connectionId, table, p.ref),
                },
            ];
        const items: { label: string; onSelect: () => void }[] = [];
        const column = menuColumn;
        if (column !== null && columns[column]) {
            const name = columns[column].name;
            if (model.editable(row, column))
                items.push({
                    label: 'Set NULL',
                    onSelect: () => {
                        const target = model.target(row);
                        if (target)
                            store.setCell(
                                connectionId,
                                table,
                                target,
                                name,
                                null,
                            );
                    },
                });
            if (model.staged(row, column))
                items.push({
                    label: 'Revert change',
                    onSelect: () =>
                        store.revertCell(connectionId, table, row.ref!, name),
                });
        }
        const targets = actionRows(row.__i);
        items.push({
            label:
                targets.length > 1
                    ? `Delete ${targets.length} rows`
                    : 'Delete row',
            onSelect: () => markDelete(targets),
        });
        return items;
    })();

    const clearSelection = () => setSelection({ rows, selected: new Set() });
    /** The bar's buttons go when the selection does: focus returns to the grid. */
    const clearAndRefocus = () => {
        clearSelection();
        const element = gridRef.current?.element;
        (
            element?.querySelector<HTMLElement>('[tabindex="0"]') ?? element
        )?.focus();
    };
    const selectedRows = [...selected]
        .sort((a, b) => a - b)
        .map((i) => rowByIndex.get(i))
        .filter((r): r is Row => !!r);
    // Delete and Restore where the row menu offers them: rows the editor can pin down.
    const removable =
        editing && model ? selectedRows.filter((r) => model.target(r)) : [];
    const restore =
        removable.length > 0 &&
        removable.every((r) => model?.pendingOf(r)?.kind === 'delete');
    const selectionBar =
        rowMenu && selectedRows.length > 0 ? (
            <SelectionBar
                count={selectedRows.length}
                copy={{
                    dialect: rowMenu.dialect,
                    table: rowMenu.table,
                    columns,
                    // New rows aren't in the table yet: nothing to copy.
                    rows: selectedRows
                        .filter((r) => r.__i >= 0)
                        .map((r) => r.cells),
                }}
                remove={
                    removable.length > 0 && editing
                        ? {
                              restore,
                              count: removable.length,
                              onSelect: () => {
                                  if (restore) {
                                      const store = usePending.getState();
                                      for (const r of removable)
                                          store.unmarkDelete(
                                              editing.connectionId,
                                              editing.table,
                                              r.ref!,
                                          );
                                  } else markDelete(removable);
                                  clearAndRefocus();
                              },
                          }
                        : null
                }
                onClear={clearAndRefocus}
            />
        ) : null;

    /** Commits what the inline editor staged (Enter, Tab, a click outside). */
    const onRowsChange = (next: Row[], change: { indexes: number[] }) => {
        if (!editing || !model) return;
        for (const i of change.indexes) {
            const r = next[i];
            if (!r?.draft) continue;
            const target = model.target(r);
            const index = columns.findIndex((c) => c.name === r.draft!.column);
            if (!target || index < 0) continue;
            const { value } = r.draft;
            if (model.isJson(index) && value !== null) {
                const problem = jsonError(value);
                if (problem) {
                    toast.error(`${columns[index].name}: ${problem}`);
                    continue;
                }
            }
            // A click outside closes the editor however its draft reads: one that can't be staged is said and dropped.
            const committed = model.committed(index, value);
            if ('error' in committed) {
                toast.error(`${columns[index].name}: ${committed.error}`);
                continue;
            }
            usePending
                .getState()
                .setCell(
                    editing.connectionId,
                    editing.table,
                    target,
                    r.draft.column,
                    committed.value,
                );
        }
    };

    const grid = (
        <DataGrid
            ref={gridRef}
            className="rdg-dbsuperb h-full font-mono text-xs"
            columns={gridColumns}
            rows={data}
            rowKeyGetter={(r) => r.__i}
            sortColumns={sortColumns}
            onSortColumnsChange={(next) =>
                sort
                    ? sort.onChange(next.slice(-maxKeys))
                    : setLocalSort(next.slice(-1))
            }
            onColumnsReorder={(source, target) =>
                setLayout((current) => {
                    const next = current.order.filter((k) => k !== source);
                    next.splice(next.indexOf(target), 0, source);
                    return { ...current, order: next };
                })
            }
            onColumnResize={layout ? onColumnResize : undefined}
            selectedRows={rowMenu ? selected : undefined}
            onSelectedRowsChange={
                rowMenu
                    ? (next) => setSelection({ rows, selected: next })
                    : undefined
            }
            rowClass={(r) => {
                const kind = model?.pendingOf(r)?.kind;
                return (
                    cn(
                        r.__i === activeRow && 'rdg-row-active',
                        kind === 'insert' && 'rdg-row-new',
                        kind === 'delete' && 'rdg-row-deleted',
                        kind && r.ref && rowErrors[r.ref] && 'rdg-row-error',
                    ) || undefined
                );
            }}
            onRowsChange={model ? onRowsChange : undefined}
            onCellContextMenu={
                rowMenu
                    ? ({ row, column }) => {
                          setMenuRow(row.__i);
                          setMenuColumn(
                              columns[Number(column.key)] &&
                                  /^\d+$/.test(column.key)
                                  ? Number(column.key)
                                  : null,
                          );
                      }
                    : undefined
            }
            onCellKeyDown={
                onOpenRow || model || rowMenu
                    ? (args, event) => {
                          if (args.mode !== 'ACTIVE') return;
                          // Escape drops the selection; an open cell editor (EDIT mode) keeps Escape to cancel.
                          if (
                              event.key === 'Escape' &&
                              rowMenu &&
                              selected.size > 0
                          ) {
                              clearSelection();
                              event.preventGridDefault();
                              // The workspace's own Escape (closing the history panel) waits for the next press.
                              event.preventDefault();
                              return;
                          }
                          if (!args.row) return;
                          const onButton =
                              event.target instanceof HTMLButtonElement;
                          if (model) {
                              const key = event.key;
                              if (key === 'Delete') {
                                  // Marks the selected rows (else this one); never opens an editor.
                                  markDelete(
                                      actionRows(
                                          selected.size > 0
                                              ? [...selected][0]
                                              : args.row.__i,
                                      ),
                                  );
                                  event.preventGridDefault();
                                  return;
                              }
                              const col = args.column;
                              const editableHere =
                                  !!col &&
                                  col.renderEditCell != null &&
                                  (typeof col.editable === 'function'
                                      ? col.editable(args.row)
                                      : col.editable) !== false;
                              // Enter and F2 edit; a typed character or Backspace would open an editor
                              // that drops it, so only those two keys start editing.
                              if (
                                  (key === 'Enter' || key === 'F2') &&
                                  editableHere &&
                                  !onButton
                              )
                                  return;
                              if (
                                  editableHere &&
                                  (key === 'Backspace' ||
                                      (key.length === 1 &&
                                          !event.ctrlKey &&
                                          !event.metaKey &&
                                          !(key === ' ' && event.shiftKey)))
                              ) {
                                  event.preventGridDefault();
                                  return;
                              }
                          }
                          if (
                              onOpenRow &&
                              args.row.__i >= 0 &&
                              event.key === 'Enter' &&
                              !onButton
                          ) {
                              onOpenRow(args.row.__i);
                              event.preventGridDefault();
                          }
                      }
                    : undefined
            }
            onScroll={
                onScrollTopChange
                    ? (event) => {
                          const element = event.currentTarget;
                          if (frame.current !== null) return;
                          frame.current = requestAnimationFrame(() => {
                              frame.current = null;
                              onScrollTopChange(element.scrollTop);
                          });
                      }
                    : undefined
            }
            onCellCopy={({ row, column }, event) => {
                if (!columns[Number(column.key)]) return;
                const value = row.cells[Number(column.key)];
                event.clipboardData.setData('text/plain', cellText(value));
                event.preventDefault();
            }}
            rowHeight={28}
            headerRowHeight={30}
        />
    );

    return (
        <>
            {rowMenu ? (
                <div className="flex h-full flex-col">
                    {selectionBar}
                    <div className="min-h-0 flex-1">
                        <ContextMenu
                            onOpenChange={(open) => {
                                if (!open) setMenuRow(null);
                            }}
                        >
                            <ContextMenuTrigger asChild>
                                <div
                                    className="h-full"
                                    onContextMenu={(event) => {
                                        // Only body cells have rows to act on; headers and empty space get no menu.
                                        if (
                                            !(
                                                event.target as HTMLElement
                                            ).closest(
                                                '[role="row"]:not([aria-rowindex="1"]) [role="gridcell"]',
                                            )
                                        ) {
                                            setMenuRow(null);
                                            event.preventDefault();
                                        }
                                    }}
                                >
                                    {grid}
                                </div>
                            </ContextMenuTrigger>
                            {(menuRows.length > 0 || editItems.length > 0) && (
                                <RowMenu
                                    dialect={rowMenu.dialect}
                                    table={rowMenu.table}
                                    columns={columns}
                                    rows={menuRows}
                                    editItems={editItems}
                                    onOpenRow={
                                        onOpenRow &&
                                        menuRow !== null &&
                                        menuRow >= 0
                                            ? () => onOpenRow(menuRow)
                                            : undefined
                                    }
                                />
                            )}
                        </ContextMenu>
                    </div>
                </div>
            ) : (
                grid
            )}
            <CellDrawer state={drawer} onClose={() => setDrawer(null)} />
        </>
    );
}
