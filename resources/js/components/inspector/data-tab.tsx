import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SortColumn } from 'react-data-grid';
import { ResultGrid } from '@/components/grid/result-grid';
import { Button } from '@/components/ui/button';
import {
    dbErrorFrom,
    workspaceApi,
    type RowFilter,
    type RowsRequest,
    type RowsResponse,
} from '@/lib/workspace-api';
import { useSqlTabs } from '@/sql/tabs-store';
import type { QueryColumn, SchemaSnapshot } from '@/types/schema';
import { useWorkspace } from '@/universe/store';
import { FilterBar } from './filter-bar';

const PER_PAGE = 100;

type Sort = RowsRequest['sort'];

const openForeign = (table: string, column: string, value: string) =>
    useWorkspace.getState().openDataFilter(table, [{ column, value }]);

const incoming = (table: string): RowFilter[] => {
    const f = useWorkspace.getState().dataFilter;
    return f && f.table === table
        ? f.filters.map((p) => ({ column: p.column, op: 'eq', value: p.value }))
        : [];
};

const sameFilters = (a: RowFilter[], b: RowFilter[]) =>
    a.length === b.length &&
    a.every(
        (f, i) =>
            f.column === b[i].column &&
            f.op === b[i].op &&
            f.value === b[i].value,
    );

export function DataTab({
    connectionId,
    table,
    snapshot,
}: {
    connectionId: number;
    table: string;
    snapshot?: SchemaSnapshot | null;
}) {
    const dataFilter = useWorkspace((s) => s.dataFilter);
    const [filters, setFilters] = useState<RowFilter[]>(() => incoming(table));
    const [sort, setSort] = useState<Sort>(null);
    const [page, setPage] = useState(1);
    const [data, setData] = useState<RowsResponse | null>(null);
    const [columns, setColumns] = useState<QueryColumn[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    // A pending FK filter for this table seeds the chips once, then is consumed.
    useEffect(() => {
        if (!dataFilter || dataFilter.table !== table) return;
        const next = incoming(table);
        setFilters((prev) => (sameFilters(prev, next) ? prev : next));
        setPage(1);
        useWorkspace.getState().clearDataFilter();
    }, [dataFilter, table]);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        workspaceApi
            .rows(
                connectionId,
                table,
                { filters, sort, page, per_page: PER_PAGE },
                controller.signal,
            )
            .then((d) => {
                if (controller.signal.aborted) return;
                setData(d);
                // Keep the column array stable across pages so the grid keeps its layout.
                setColumns((prev) =>
                    prev.length === d.columns.length &&
                    prev.every((c, i) => c.name === d.columns[i].name)
                        ? prev
                        : d.columns,
                );
                setLoading(false);
            })
            .catch((e) => {
                if (controller.signal.aborted) return;
                setData(null);
                setError(dbErrorFrom(e, 'Could not load rows.').message);
                setLoading(false);
            });
        return () => controller.abort();
    }, [connectionId, table, filters, sort, page]);

    const changeFilters = useCallback((next: RowFilter[]) => {
        setFilters(next);
        setPage(1);
    }, []);

    const sortColumns: SortColumn[] = useMemo(() => {
        if (!sort) return [];
        const index = columns.findIndex((c) => c.name === sort.column);
        return index < 0
            ? []
            : [
                  {
                      columnKey: String(index),
                      direction: sort.direction === 'asc' ? 'ASC' : 'DESC',
                  },
              ];
    }, [sort, columns]);

    const gridSort = useMemo(
        () => ({
            columns: sortColumns,
            onChange: (next: SortColumn[]) => {
                const column = next[0] && columns[Number(next[0].columnKey)];
                setSort(
                    column
                        ? {
                              column: column.name,
                              direction:
                                  next[0].direction === 'ASC' ? 'asc' : 'desc',
                          }
                        : null,
                );
                setPage(1);
            },
        }),
        [sortColumns, columns],
    );

    const filterColumns = useMemo(
        () =>
            snapshot?.tables
                .find((t) => t.name === table)
                ?.columns.map((c) => c.name) ?? columns.map((c) => c.name),
        [snapshot, table, columns],
    );

    const openInSql = () => {
        if (!data) return;
        useSqlTabs.getState().openTab(connectionId, data.sql, table);
        useWorkspace.getState().setDockOpen(true);
    };

    // The range describes the rows on screen, not the page being requested.
    const from = data ? (data.page - 1) * data.per_page + 1 : 0;
    const to = data ? from + data.rows.length - 1 : 0;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <FilterBar
                columns={filterColumns}
                filters={filters}
                onChange={changeFilters}
            />
            {error && (
                <p role="alert" className="px-4 py-3 text-xs text-destructive">
                    {error}
                </p>
            )}
            <div className="min-h-0 flex-1">
                {data && data.columns.length > 0 ? (
                    <ResultGrid
                        columns={columns}
                        rows={data.rows}
                        snapshot={snapshot}
                        onOpenForeign={openForeign}
                        sort={gridSort}
                    />
                ) : (
                    !error && (
                        <p className="px-4 py-3 text-xs text-muted-foreground">
                            {loading ? 'Loading rows…' : 'No rows.'}
                        </p>
                    )
                )}
            </div>
            <div className="flex items-center gap-2 border-t px-4 py-2 text-xs">
                <span className="text-muted-foreground">
                    {data && data.rows.length > 0
                        ? `Rows ${from}–${to}`
                        : 'No rows'}
                </span>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading || page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                >
                    Previous page
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading || !data?.has_more}
                    onClick={() => setPage((p) => p + 1)}
                >
                    Next page
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    disabled={loading || !data}
                    onClick={openInSql}
                >
                    Open in SQL
                </Button>
            </div>
        </div>
    );
}
