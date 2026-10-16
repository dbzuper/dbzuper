import 'react-data-grid/lib/styles.css';
import { DataGrid, type Column, type SortColumn } from 'react-data-grid';
import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
    cellKind,
    cellText,
    fkTarget,
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
import { cn } from '@/lib/utils';
import type { QueryCell, QueryColumn, SchemaSnapshot } from '@/types/schema';
import { CellDrawer, type DrawerState } from './cell-drawer';

type Row = { __i: number; cells: QueryCell[] };

type Props = {
    columns: QueryColumn[];
    rows: QueryCell[][];
    snapshot?: SchemaSnapshot | null;
    onOpenForeign?: (table: string, column: string, value: string) => void;
    /**
     * Opens a record. FK cells use it when the relationship targets the parent's whole key (else
     * onOpenForeign), and a leading "Open record" button appears when the rows map to one explorable table.
     */
    onOpenRecord?: (target: RecordTarget) => void;
    /** Server-side sorting (data tab); when omitted the grid sorts the fetched rows client-side. */
    sort?: { columns: SortColumn[]; onChange: (columns: SortColumn[]) => void };
};

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
            className={cn(
                kind === 'number' && 'block text-right tabular-nums',
                kind === 'binary' && 'text-muted-foreground italic',
                kind === 'boolean' && 'text-[var(--universe-accent)]',
            )}
        >
            {preview}
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
}: Props) {
    const [layout, setLayout] = useState(() => ({
        columns,
        order: initialOrder(columns),
    }));
    const [localSort, setLocalSort] = useState<SortColumn[]>([]);
    const [drawer, setDrawer] = useState<DrawerState>(null);

    // A new result set invalidates the column order and the client-side sort.
    let order = layout.order;
    if (layout.columns !== columns) {
        order = initialOrder(columns);
        setLayout({ columns, order });
        setLocalSort([]);
    }

    const sortColumns = sort?.columns ?? localSort;
    const data: Row[] = useMemo(() => {
        const active = sort ? undefined : localSort[0];
        const sorted = active
            ? sortRows(rows, Number(active.columnKey), active.direction)
            : rows;
        return sorted.map((cells, i) => ({ __i: i, cells }));
    }, [rows, localSort, sort]);

    // Whether the rows stand for records is a property of the result, decided once from its first row.
    const rowActions = useMemo(
        () =>
            !!(
                snapshot &&
                onOpenRecord &&
                rows.length > 0 &&
                rowRecordTarget(snapshot, columns, rows[0])
            ),
        [snapshot, onOpenRecord, columns, rows],
    );

    const gridColumns: Column<Row>[] = useMemo(() => {
        const openColumn: Column<Row>[] =
            rowActions && snapshot && onOpenRecord
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
                                  aria-label="Open record"
                                  title="Open record"
                                  onClick={() => {
                                      const target = rowRecordTarget(
                                          snapshot,
                                          columns,
                                          row.cells,
                                      );
                                      if (target) onOpenRecord(target);
                                  }}
                                  className="rounded text-muted-foreground hover:text-[var(--universe-accent)] focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none"
                              >
                                  <ExternalLink className="size-3.5" />
                              </button>
                          ),
                      },
                  ]
                : [];
        return [
            ...openColumn,
            ...order
                .filter((key) => columns[Number(key)])
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
    }, [order, columns, snapshot, onOpenForeign, onOpenRecord, rowActions]);

    return (
        <>
            <DataGrid
                className="rdg-dbsuperb h-full font-mono text-xs"
                columns={gridColumns}
                rows={data}
                rowKeyGetter={(r) => r.__i}
                sortColumns={sortColumns}
                onSortColumnsChange={(next) =>
                    sort
                        ? sort.onChange(next.slice(-1))
                        : setLocalSort(next.slice(-1))
                }
                onColumnsReorder={(source, target) =>
                    setLayout((current) => {
                        const next = current.order.filter((k) => k !== source);
                        next.splice(next.indexOf(target), 0, source);
                        return { ...current, order: next };
                    })
                }
                onCellCopy={({ row, column }, event) => {
                    if (column.key === '__open') return;
                    const value = row.cells[Number(column.key)];
                    event.clipboardData.setData('text/plain', cellText(value));
                    event.preventDefault();
                }}
                rowHeight={28}
                headerRowHeight={30}
            />
            <CellDrawer state={drawer} onClose={() => setDrawer(null)} />
        </>
    );
}
