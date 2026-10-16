import 'react-data-grid/lib/styles.css';
import {
    DataGrid,
    SelectColumn,
    renderHeaderCell as defaultHeaderCell,
    type Column,
    type DataGridHandle,
    type SortColumn,
} from 'react-data-grid';
import { ChevronRight, ExternalLink, Filter } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { cn } from '@/lib/utils';
import type {
    Dialect,
    QueryCell,
    QueryColumn,
    SchemaSnapshot,
} from '@/types/schema';
import { CellDrawer, type DrawerState } from './cell-drawer';
import { RowMenu } from './row-menu';

type Row = { __i: number; cells: QueryCell[] };

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
    /** Server-side sorting (data tab); when omitted the grid sorts the fetched rows client-side. */
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
    /** Highlights this row (the drawer's row). */
    activeRow?: number | null;
    /** Enables row checkboxes and the copy menu (Copy as JSON / INSERT / CSV). */
    rowMenu?: { dialect: Dialect; table: string };
    /** Restores and reports the vertical scroll offset. */
    scrollTop?: number;
    onScrollTopChange?: (top: number) => void;
};

const MAX_WIDTH = 480;
const RESIZE_DEBOUNCE_MS = 200;

const PREVIEW_CHARS = 120;

export function CellView({
    value,
    type,
    onOpen,
    foreign,
}: {
    value: CellValue;
    type: string | null;
    onOpen: () => void;
    foreign?: { label: string; onClick: () => void } | null;
}) {
    const kind = cellKind(value, type);
    if (kind === 'null')
        return (
            <span data-null="true" className="text-muted-foreground/60 italic">
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
            title={expandable ? cellTitle(textValue) : undefined}
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
    activeRow = null,
    rowMenu,
    scrollTop,
    onScrollTopChange,
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
    }

    const layoutRef = useRef(layout);
    useEffect(() => {
        layoutRef.current = layout;
    });
    const pendingWidths = useRef<Record<string, number>>({});
    const resizeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
    );
    useEffect(() => () => clearTimeout(resizeTimer.current), []);
    const onColumnResize = (column: { name: unknown }, width: number) => {
        if (!layoutRef.current || typeof column.name !== 'string') return;
        pendingWidths.current[column.name] = Math.min(
            MAX_WIDTH,
            Math.round(width),
        );
        clearTimeout(resizeTimer.current);
        resizeTimer.current = setTimeout(() => {
            const current = layoutRef.current;
            if (!current) return;
            current.onChange({
                ...current.value,
                widths: { ...current.value.widths, ...pendingWidths.current },
            });
            pendingWidths.current = {};
        }, RESIZE_DEBOUNCE_MS);
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

    const sortColumns = sort?.columns ?? localSort;
    const data: Row[] = useMemo(() => {
        const active = sort ? undefined : localSort[0];
        const sorted = active
            ? sortRows(rows, Number(active.columnKey), active.direction)
            : rows;
        return sorted.map((cells, i) => ({ __i: i, cells }));
    }, [rows, localSort, sort]);

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
        const rowButton: Column<Row>[] = onOpenRow
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
                      renderCell: ({ row }) => (
                          <button
                              type="button"
                              aria-label="Open row"
                              title="Open row"
                              onClick={() => onOpenRow(row.__i)}
                              className="rounded text-muted-foreground hover:text-[var(--universe-accent)] focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none"
                          >
                              <ChevronRight className="size-3.5" />
                          </button>
                      ),
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
                                          className="shrink-0 rounded text-muted-foreground hover:text-[var(--universe-accent)] focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none"
                                      >
                                          <Filter className="size-3" />
                                      </button>
                                  </span>
                              )
                            : undefined,
                        renderCell: ({ row }) => {
                            const value = row.cells[index];
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
                            return (
                                <CellView
                                    value={value}
                                    type={column.type}
                                    foreign={foreign}
                                    onOpen={() => setDrawer({ column, value })}
                                />
                            );
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
        onFilterColumn,
    ]);

    const maxKeys = Math.max(1, sort?.maxKeys ?? 1);
    const menuRows = useMemo(() => {
        if (menuRow === null || !rowMenu) return [];
        const indices = selected.has(menuRow)
            ? [...selected].sort((a, b) => a - b)
            : [menuRow];
        return indices.flatMap((i) => (data[i] ? [data[i].cells] : []));
    }, [menuRow, selected, data, rowMenu]);

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
            rowClass={(r) =>
                r.__i === activeRow ? 'rdg-row-active' : undefined
            }
            onCellContextMenu={
                rowMenu ? ({ row }) => setMenuRow(row.__i) : undefined
            }
            onCellKeyDown={
                onOpenRow
                    ? (args, event) => {
                          if (
                              args.mode === 'ACTIVE' &&
                              args.row &&
                              event.key === 'Enter'
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
                          const top = event.currentTarget.scrollTop;
                          if (frame.current !== null) return;
                          frame.current = requestAnimationFrame(() => {
                              frame.current = null;
                              onScrollTopChange(top);
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
                <ContextMenu>
                    <ContextMenuTrigger asChild>
                        <div className="h-full">{grid}</div>
                    </ContextMenuTrigger>
                    <RowMenu
                        dialect={rowMenu.dialect}
                        table={rowMenu.table}
                        columns={columns}
                        rows={menuRows}
                        onOpenRow={
                            onOpenRow && menuRow !== null
                                ? () => onOpenRow(menuRow)
                                : undefined
                        }
                    />
                </ContextMenu>
            ) : (
                grid
            )}
            <CellDrawer state={drawer} onClose={() => setDrawer(null)} />
        </>
    );
}
