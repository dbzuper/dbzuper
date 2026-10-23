import { quoteIdent } from '@/grid/copy';
import { addDays, dateKind, isDateOnly } from '@/lib/date-filter';
import type { DateKind } from '@/lib/date-filter';
import type { PerPage, RowFilter, SortKey } from '@/lib/workspace-api';
import type { Dialect } from '@/types/schema';

const COMPARE: Partial<Record<RowFilter['op'], string>> = {
    eq: '=',
    neq: '<>',
    lt: '<',
    lte: '<=',
    gt: '>',
    gte: '>=',
};

/** A string literal quoted the way the server's connection quotes it (backslash escapes on MySQL/MariaDB). */
function literal(dialect: Dialect, value: string): string {
    return dialect === 'mysql' || dialect === 'mariadb'
        ? `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
        : `'${value.replace(/'/g, "''")}'`;
}

/** The table's columns, for the date operators' column kind. */
export type TableColumns = readonly { name: string; type_name: string }[];

/**
 * The date operators in exactly the server's shapes (TableRowsQuery::applyDate). A range is BETWEEN on a date
 * column, or with two timed ends; otherwise `>= A` and `< B+1` (B a day) or `<= B` (B timed).
 */
function dateCondition(
    dialect: Dialect,
    col: string,
    op: RowFilter['op'],
    value: string,
    to: string,
    kind: DateKind | null,
): string | null {
    const cmp = (o: string, v: string) => `${col} ${o} ${literal(dialect, v)}`;
    if (op === 'on')
        return `${cmp('>=', value)} AND ${cmp('<', addDays(value, 1))}`;
    if (op === 'after')
        return isDateOnly(value)
            ? cmp('>=', addDays(value, 1))
            : cmp('>', value);
    if (op !== 'between') return null;
    if (kind === 'date' || (!isDateOnly(value) && !isDateOnly(to)))
        return `${col} BETWEEN ${literal(dialect, value)} AND ${literal(dialect, to)}`;
    return `${cmp('>=', value)} AND ${
        isDateOnly(to) ? cmp('<', addDays(to, 1)) : cmp('<=', to)
    }`;
}

function condition(
    dialect: Dialect,
    f: RowFilter,
    columns: TableColumns,
): string {
    const col = quoteIdent(dialect, f.column);
    if (f.op === 'is_null') return `${col} IS NULL`;
    if (f.op === 'is_not_null') return `${col} IS NOT NULL`;
    const value = f.value ?? '';
    const column = columns.find((c) => c.name === f.column);
    const date = dateCondition(
        dialect,
        col,
        f.op,
        value,
        f.to ?? '',
        column ? dateKind(column) : null,
    );
    if (date !== null) return date;
    const op = COMPARE[f.op];
    if (op) return `${col} ${op} ${literal(dialect, value)}`;
    const escaped = value.replace(/[!%_]/g, (c) => `!${c}`);
    const pattern =
        f.op === 'contains'
            ? `%${escaped}%`
            : f.op === 'starts_with'
              ? `${escaped}%`
              : `%${escaped}`;
    const like =
        dialect === 'pgsql' ? `CAST(${col} AS TEXT) ILIKE` : `${col} LIKE`;
    return `${like} ${literal(dialect, pattern)} ESCAPE '!'`;
}

/**
 * A SELECT equivalent to the table tab's rows request (the server's own SQL is used whenever it is known): the
 * same filters, sort and page with the server's quoting and LIKE form, so the matcher maps it back to the same
 * state. The primary-key tie-breaker the server appends is left out; it changes nothing. `columns` gives each date
 * filter its column kind (a column it doesn't list gets the datetime shapes).
 */
export function buildTableSql(
    dialect: Dialect,
    table: string,
    state: {
        filters: RowFilter[];
        sort: SortKey[];
        page: number;
        perPage: PerPage;
    },
    columns: TableColumns,
): string {
    let sql = `SELECT * FROM ${quoteIdent(dialect, table)}`;
    if (state.filters.length > 0)
        sql += ` WHERE ${state.filters.map((f) => condition(dialect, f, columns)).join(' AND ')}`;
    if (state.sort.length > 0)
        sql += ` ORDER BY ${state.sort
            .map(
                (s) =>
                    `${quoteIdent(dialect, s.column)} ${s.direction.toUpperCase()}`,
            )
            .join(', ')}`;
    sql += ` LIMIT ${state.perPage}`;
    if (state.page > 1) sql += ` OFFSET ${(state.page - 1) * state.perPage}`;
    return sql;
}
