import { fkTarget } from '@/grid/cells';
import type {
    QueryCell,
    QueryColumn,
    SchemaSnapshot,
    TableSchema,
} from '@/types/schema';
import { useWorkspace } from '@/universe/store';
import { useRecords } from './records-store';
import type { RecordKeyValues } from './types';

export type RecordTarget = { table: string; key: RecordKeyValues };

const BINARY_TYPE = /blob|binary|varbinary|bytea/i;
const BINARY_PLACEHOLDER = /^\[binary \d+ bytes\]$/;
const INTEGER_TYPE = /int/i;

const columnType = (table: TableSchema, name: string) =>
    table.columns.find((c) => c.name === name)?.type ?? '';

/** A table whose rows can be opened as records: a real table with a usable, non-binary primary key. */
export function explorableTable(
    snapshot: SchemaSnapshot,
    table: string,
): TableSchema | null {
    const found = snapshot.tables.find((t) => t.name === table);
    if (!found || found.kind !== 'table' || found.primary_key.length === 0)
        return null;
    if (found.primary_key.some((c) => BINARY_TYPE.test(columnType(found, c))))
        return null;
    return found;
}

/** The server's canonical key value for a column: safe integers as numbers, everything else as strings. */
function canonicalValue(
    type: string,
    value: QueryCell,
): string | number | null {
    if (value === null) return null;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (INTEGER_TYPE.test(type)) {
        const text = String(value).trim();
        if (/^[+-]?\d+$/.test(text)) {
            const big = BigInt(text);
            const limit = BigInt(Number.MAX_SAFE_INTEGER);
            return big >= -limit && big <= limit ? Number(big) : big.toString();
        }
        return typeof value === 'number' ? String(value) : null;
    }
    return String(value);
}

function buildKey(
    table: TableSchema,
    values: QueryCell[],
): RecordKeyValues | null {
    const key: RecordKeyValues = {};
    for (let i = 0; i < table.primary_key.length; i++) {
        const name = table.primary_key[i];
        const value = values[i];
        if (
            value === null ||
            (typeof value === 'string' && BINARY_PLACEHOLDER.test(value))
        )
            return null;
        const canonical = canonicalValue(columnType(table, name), value);
        if (canonical === null) return null;
        key[name] = canonical;
    }
    return key;
}

/** The parent record an FK cell points at, when the relationship targets the parent's whole primary key. */
export function foreignRecordTarget(
    snapshot: SchemaSnapshot,
    column: QueryColumn,
    value: QueryCell,
): RecordTarget | null {
    if (value === null || !fkTarget(column, snapshot)) return null;
    const rel = snapshot.relationships.find(
        (r) =>
            r.from_table === column.table &&
            r.from_columns.length === 1 &&
            r.from_columns[0] === column.name,
    );
    if (!rel) return null;
    const parent = explorableTable(snapshot, rel.to_table);
    if (
        !parent ||
        rel.to_columns.length !== parent.primary_key.length ||
        !parent.primary_key.every((c) => rel.to_columns.includes(c))
    )
        return null;
    const key = buildKey(parent, [value]);
    return key ? { table: parent.name, key } : null;
}

/** The record a result row stands for: all columns from one explorable table, with its whole key present. */
export function rowRecordTarget(
    snapshot: SchemaSnapshot,
    columns: QueryColumn[],
    row: QueryCell[],
): RecordTarget | null {
    const name = columns[0]?.table;
    if (!name || columns.some((c) => c.table !== name)) return null;
    const table = explorableTable(snapshot, name);
    if (!table) return null;
    const values: QueryCell[] = [];
    for (const pk of table.primary_key) {
        const indexes = columns.flatMap((c, i) => (c.name === pk ? [i] : []));
        if (indexes.length !== 1) return null;
        values.push(row[indexes[0]] ?? null);
    }
    const key = buildKey(table, values);
    return key ? { table: table.name, key } : null;
}

/** Parses `users 42` or `product_tags 1, rgb` from the command palette. */
export function parsePaletteRecord(
    snapshot: SchemaSnapshot,
    query: string,
): RecordTarget | null {
    const match = query.match(/^\s*(\S+)\s+(.+?)\s*$/);
    if (!match) return null;
    const [, word, rest] = match;
    const named =
        snapshot.tables.find((t) => t.name === word) ??
        snapshot.tables.find(
            (t) => t.name.toLowerCase() === word.toLowerCase(),
        );
    if (!named) return null;
    const table = explorableTable(snapshot, named.name);
    if (!table) return null;
    const parts =
        table.primary_key.length === 1
            ? [rest]
            : rest.split(',').map((p) => p.trim());
    if (
        parts.length !== table.primary_key.length ||
        parts.some((p) => p === '')
    )
        return null;
    const key = buildKey(table, parts);
    return key ? { table: table.name, key } : null;
}

export const keyDisplay = (key: RecordKeyValues) =>
    Object.values(key).join(', ');

export function openRecord(target: RecordTarget) {
    useRecords.getState().open(target.table, target.key);
    useWorkspace.getState().setView('records');
}
