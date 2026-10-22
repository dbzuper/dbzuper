import { quoteIdent } from '@/grid/copy';
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

function condition(dialect: Dialect, f: RowFilter): string {
    const col = quoteIdent(dialect, f.column);
    if (f.op === 'is_null') return `${col} IS NULL`;
    if (f.op === 'is_not_null') return `${col} IS NOT NULL`;
    const value = f.value ?? '';
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
 * state. The primary-key tie-breaker the server appends is left out; it changes nothing.
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
): string {
    let sql = `SELECT * FROM ${quoteIdent(dialect, table)}`;
    if (state.filters.length > 0)
        sql += ` WHERE ${state.filters.map((f) => condition(dialect, f)).join(' AND ')}`;
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
