import type { QueryCell, QueryColumn, SchemaSnapshot } from '@/types/schema';

/** A query cell as the grid may receive it: drivers can hand back decoded JSON objects and arrays. */
export type CellValue = QueryCell | object;

/** Plain text of a cell for display, copy and the drawer: objects as JSON, null as ''. */
export function cellText(value: CellValue): string {
    if (value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

export function cellKind(
    value: CellValue,
    type: string | null,
): 'null' | 'number' | 'boolean' | 'json' | 'date' | 'binary' | 'text' {
    if (value === null) return 'null';
    if (typeof value === 'object') return 'json';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    const t = (type ?? '').toLowerCase();
    if (/^\[binary \d+ bytes\]$/.test(value)) return 'binary';
    if (
        /int|numeric|decimal|float|double|real|money/.test(t) &&
        !Number.isNaN(Number(value))
    )
        return 'number';
    if (/json/.test(t) || /^\s*[[{]/.test(value)) {
        try {
            JSON.parse(value);
            return 'json';
        } catch {
            /* not JSON */
        }
    }
    if (/date|time/.test(t)) return 'date';
    return 'text';
}

export const isLong = (value: CellValue) =>
    typeof value === 'string' && (value.length > 120 || value.includes('\n'));

export function fkTarget(
    column: QueryColumn,
    snapshot: SchemaSnapshot,
): { table: string; column: string } | null {
    if (!column.table) return null;
    const rel = snapshot.relationships.find(
        (r) =>
            r.from_table === column.table &&
            r.from_columns.length === 1 &&
            r.from_columns[0] === column.name,
    );
    return rel ? { table: rel.to_table, column: rel.to_columns[0] } : null;
}
