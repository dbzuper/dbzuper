import { binaryBytes, cellText } from '@/grid/cells';
import type { RowIdentity } from '@/lib/workspace-api';
import type {
    ColumnSchema,
    Dialect,
    QueryCell,
    QueryColumn,
} from '@/types/schema';
import { refOf, type PendingTarget } from './pending-store';

/**
 * The editing rules shared by the grid and the row drawer (spec §4.1, §4.2, §6): which rows and cells can be edited,
 * why not, and how a value is turned into staged text.
 */

/** Staged editing of a table tab's rows. Only given for an editable table on a writable connection. */
export type GridEditing = {
    connectionId: number;
    table: string;
    dialect: Dialect;
    /** From the rows response, parallel to `rows`. */
    rowIds: (RowIdentity | null)[];
    locked: number[][];
    shortened: number[][];
    readOnlyColumns: string[];
    /** Why a row without an identity can't be edited; a generic reason when null. */
    rowReason: string | null;
    /** The table's columns: defaults and NOT NULL for new rows, type names for editors. */
    tableColumns: ColumnSchema[];
};

export const UNPINNED_ROW =
    "this row can't be pinned to exactly one row (some of its values were shortened or can't be compared exactly)";

/** Column type tests for editing (type names as the snapshot reports them). */
export const isBooleanType = (type: string | null) =>
    /^bool(ean)?$/i.test((type ?? '').trim());
export const isJsonType = (type: string | null) => /json/i.test(type ?? '');
export const isBinaryType = (type: string | null) =>
    /blob|binary|bytea|varbinary|image/i.test(type ?? '');

/** Why a JSON value can't be staged, or null when it parses. */
export function jsonError(text: string): string | null {
    try {
        JSON.parse(text);
        return null;
    } catch (e) {
        return `Invalid JSON: ${e instanceof Error ? e.message : 'it does not parse'}`;
    }
}

/** A column's type: the table's own type name when known, else the result column's. */
export function columnType(
    editing: GridEditing,
    column: QueryColumn,
): string | null {
    return (
        editing.tableColumns.find((c) => c.name === column.name)?.type_name ??
        column.type
    );
}

/** The pending target of loaded row `index` (`cells` are its loaded values), or null when it has no identity. */
export function rowTarget(
    editing: GridEditing,
    columns: QueryColumn[],
    index: number,
    cells: QueryCell[],
): PendingTarget | null {
    const id = editing.rowIds[index];
    if (!id) return null;
    const cut = new Set(editing.shortened[index] ?? []);
    const original: Record<string, QueryCell> = {};
    const shortened: string[] = [];
    columns.forEach((c, i) => {
        if (cut.has(i)) shortened.push(c.name);
        else original[c.name] = cells[i];
    });
    return { ref: refOf(id), id, original, shortened };
}

/**
 * Why cell `column` of loaded row `index` can't be edited (without the "Not editable:" prefix), or null when it can.
 * Multi-line values are not locked here: only the grid's single-line editor can't hold them.
 */
export function lockedFor(
    editing: GridEditing,
    columns: QueryColumn[],
    index: number,
    cells: QueryCell[] | undefined,
    column: number,
): string | null {
    const name = columns[column].name;
    if (!editing.rowIds[index]) return editing.rowReason ?? UNPINNED_ROW;
    if (!(editing.locked[index] ?? []).includes(column)) return null;
    // Binary first: the server lists binary columns as read-only along with generated ones.
    if (
        isBinaryType(columnType(editing, columns[column])) ||
        binaryBytes(cells?.[column] ?? null) !== null
    )
        return 'binary';
    if (editing.readOnlyColumns.includes(name)) return 'generated column';
    if ((editing.shortened[index] ?? []).includes(column))
        return 'shortened for display';
    return "its values can't be compared exactly";
}

/** A boolean as staged text: `true/false` on PostgreSQL, `1/0` elsewhere (spec §6). */
export const boolValue = (dialect: Dialect, on: boolean) =>
    dialect === 'pgsql' ? String(on) : on ? '1' : '0';

export const truthy = (value: QueryCell | undefined) =>
    value === true ||
    value === 1 ||
    (typeof value === 'string' && /^(1|t|true)$/i.test(value));

/** The text an editor starts from (NULL edits as empty text; empty text stages an empty string). */
export const editorText = (value: QueryCell | undefined) =>
    value === null || value === undefined ? '' : cellText(value);

/** How a value is shown in a tooltip or an "Original" line. */
export const shownText = (value: QueryCell | undefined) =>
    value === null || value === undefined
        ? 'NULL'
        : value === ''
          ? '(empty)'
          : cellText(value);

/**
 * Why a value can't be edited in a text control without changing it, or null. Browsers hand back a textarea's text
 * with every line end as \n, so a value whose line ends are mixed could not be kept exactly.
 */
export function lineEndProblem(value: QueryCell | undefined): string | null {
    if (typeof value !== 'string') return null;
    const crlf = /\r\n/.test(value);
    const lf = /(^|[^\r])\n/.test(value);
    const cr = /\r(?!\n)/.test(value);
    return [crlf, lf, cr].filter(Boolean).length > 1
        ? 'mixed line ends (an editor would change them)'
        : null;
}

/** `edited` (line ends as \n, as a textarea gives them) with the line ends of `base`, the value it started from. */
export function restoreLineEnds(base: string, edited: string): string {
    if (/\r\n/.test(base)) return edited.replace(/\r?\n/g, '\r\n');
    if (/\r/.test(base)) return edited.replace(/\n/g, '\r');
    return edited;
}
