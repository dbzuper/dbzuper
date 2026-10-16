import { cellText } from './cells';
import type { Dialect, QueryCell, QueryColumn } from '@/types/schema';

const text = (v: QueryCell) => cellText(v);

export function toTSV(columns: QueryColumn[], rows: QueryCell[][]): string {
    const esc = (v: QueryCell) =>
        text(v)
            .replace(/\\/g, '\\\\')
            .replace(/\t/g, '\\t')
            .replace(/\r?\n/g, '\\n');
    return [
        columns.map((c) => c.name).join('\t'),
        ...rows.map((r) => r.map(esc).join('\t')),
    ].join('\n');
}

export function toCSV(columns: QueryColumn[], rows: QueryCell[][]): string {
    const esc = (v: QueryCell) => {
        const s = text(v);
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return (
        [columns.map((c) => esc(c.name)), ...rows.map((r) => r.map(esc))]
            .map((line) => line.join(','))
            .join('\r\n') + '\r\n'
    );
}

export function toJSON(columns: QueryColumn[], rows: QueryCell[][]): string {
    const seen = new Map<string, number>();
    const used = new Set(columns.map((c) => c.name));
    const keys = columns.map((c, i) => {
        if (columns.findIndex((o) => o.name === c.name) === i) return c.name;
        let n = seen.get(c.name) ?? 1;
        let key: string;
        do {
            n++;
            key = `${c.name}_${n}`;
        } while (used.has(key));
        seen.set(c.name, n);
        used.add(key);
        return key;
    });
    return JSON.stringify(
        rows.map((r) =>
            Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null])),
        ),
        null,
        2,
    );
}

/** Writes to the clipboard; resolves false (never throws) when the Clipboard API is unavailable or denied. */
export async function writeClipboard(value: string): Promise<boolean> {
    try {
        if (!navigator.clipboard?.writeText) return false;
        await navigator.clipboard.writeText(value);
        return true;
    } catch {
        return false;
    }
}

const NUMERIC_TYPE = /int|numeric|decimal|float|double|real|money|serial/i;

function quoteIdent(dialect: Dialect, name: string): string {
    return dialect === 'mysql' || dialect === 'mariadb'
        ? '`' + name.replace(/`/g, '``') + '`'
        : '"' + name.replace(/"/g, '""') + '"';
}

function literal(
    dialect: Dialect,
    column: QueryColumn,
    value: QueryCell | object,
): string {
    if (value === null) return 'NULL';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number') return String(value);
    const s = typeof value === 'object' ? JSON.stringify(value) : value;
    if (NUMERIC_TYPE.test(column.type ?? '') && /^[+-]?\d+(\.\d+)?$/.test(s))
        return s;
    // MySQL and MariaDB treat backslash as an escape inside string literals by default.
    const body =
        dialect === 'mysql' || dialect === 'mariadb'
            ? s.replace(/\\/g, '\\\\')
            : s;
    return `'${body.replace(/'/g, "''")}'`;
}

/** Rows as one multi-row INSERT for the given engine. */
export function toInsert(
    dialect: Dialect,
    table: string,
    columns: QueryColumn[],
    rows: QueryCell[][],
): string {
    const names = columns.map((c) => quoteIdent(dialect, c.name)).join(', ');
    const values = rows
        .map(
            (r) =>
                `(${columns.map((c, i) => literal(dialect, c, r[i] ?? null)).join(', ')})`,
        )
        .join(',\n');
    return `INSERT INTO ${quoteIdent(dialect, table)} (${names}) VALUES\n${values};`;
}
