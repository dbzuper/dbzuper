import { create } from 'zustand';
import type { RowIdentity } from '@/lib/workspace-api';
import type { QueryCell } from '@/types/schema';
import type { ChangeRequest } from './editing-api';

/** A pending row's stable key: the JSON of its RowIdentity, or `new:<uuid>` for a row not yet inserted. */
export type RowRef = string;

/** Values as staged: text (bound by the server) or NULL. */
export type StagedValues = Record<string, string | null>;

export type PendingRow =
    | { kind: 'insert'; ref: RowRef; values: StagedValues }
    | {
          kind: 'update';
          ref: RowRef;
          id: RowIdentity;
          /** The row's exact loaded values, by column; shortened cells are left out (listed in `shortened`). */
          original: Record<string, QueryCell>;
          /** Columns whose loaded value was shortened for display (or is binary): no exact original exists. */
          shortened: string[];
          values: StagedValues;
      }
    | {
          kind: 'delete';
          ref: RowRef;
          id: RowIdentity;
          original: Record<string, QueryCell>;
          shortened: string[];
          /** Edits staged before the row was marked, restored when it is unmarked. */
          edits?: StagedValues;
      };

/** A row as the grid hands it over: its identity (null for a new row) and exact loaded values. */
export type PendingTarget = {
    ref: RowRef;
    id: RowIdentity | null;
    original: Record<string, QueryCell>;
    shortened?: string[];
};

export type PendingCounts = {
    inserted: number;
    updated: number;
    deleted: number;
};

type Table = Record<RowRef, PendingRow>;

type State = {
    /** By `${connectionId}:${table}`: every view (tab) of a table shares one set (spec §3, §4.4). */
    byTable: Record<string, Table>;
    /** Stages `value` for a cell; setting it back to the original removes the change. */
    setCell(
        connectionId: number,
        table: string,
        row: PendingTarget,
        column: string,
        value: string | null,
    ): void;
    revertCell(
        connectionId: number,
        table: string,
        ref: RowRef,
        column: string,
    ): void;
    /** Adds an empty new row (every column at its default) and returns its ref. */
    addRow(connectionId: number, table: string): RowRef;
    /** Marks a loaded row for deletion; a new row is simply removed. */
    markDelete(connectionId: number, table: string, row: PendingTarget): void;
    unmarkDelete(connectionId: number, table: string, ref: RowRef): void;
    discard(connectionId: number, table: string): void;
    count(connectionId: number, table: string): PendingCounts;
};

export const pendingKey = (connectionId: number, table: string) =>
    `${connectionId}:${table}`;

/** The ref of a loaded row: its identity as JSON (the server always sends identity keys in one order). */
export const refOf = (id: RowIdentity): RowRef => JSON.stringify(id);

export const isNewRef = (ref: RowRef) => ref.startsWith('new:');

const newRef = (): RowRef =>
    `new:${
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    }`;

/** Whether a staged value equals the loaded one (numbers and booleans by their text forms). */
export function sameValue(
    original: QueryCell | undefined,
    value: string | null,
) {
    if (original === undefined) return false;
    if (original === null || value === null) return original === value;
    if (typeof original === 'boolean')
        return original
            ? value === 'true' || value === '1'
            : value === 'false' || value === '0';
    return String(original) === value;
}

const without = <T extends object>(map: T, key: string): T => {
    const next = { ...map } as Record<string, unknown>;
    delete next[key];
    return next as T;
};

export const usePending = create<State>()((set, get) => {
    const patch = (
        connectionId: number,
        table: string,
        fn: (rows: Table) => Table,
    ) =>
        set((s) => {
            const key = pendingKey(connectionId, table);
            const before = s.byTable[key] ?? {};
            const after = fn(before);
            if (after === before) return s;
            return {
                byTable:
                    Object.keys(after).length === 0
                        ? without(s.byTable, key)
                        : { ...s.byTable, [key]: after },
            };
        });

    return {
        byTable: {},
        setCell: (connectionId, table, row, column, value) =>
            patch(connectionId, table, (rows) => {
                const current = rows[row.ref];
                if (current?.kind === 'delete') return rows;
                if (current?.kind === 'insert')
                    return {
                        ...rows,
                        [row.ref]: {
                            ...current,
                            values: { ...current.values, [column]: value },
                        },
                    };
                if (!row.id) return rows;
                const values = { ...current?.values };
                if (
                    sameValue(
                        (current?.original ?? row.original)[column],
                        value,
                    )
                )
                    delete values[column];
                else values[column] = value;
                if (Object.keys(values).length === 0)
                    return without(rows, row.ref);
                return {
                    ...rows,
                    [row.ref]: {
                        kind: 'update',
                        ref: row.ref,
                        id: current?.id ?? row.id,
                        original: current?.original ?? row.original,
                        shortened: current?.shortened ?? row.shortened ?? [],
                        values,
                    },
                };
            }),
        revertCell: (connectionId, table, ref, column) =>
            patch(connectionId, table, (rows) => {
                const current = rows[ref];
                if (!current || current.kind === 'delete') return rows;
                if (!(column in current.values)) return rows;
                const values = without(current.values, column);
                if (
                    current.kind === 'update' &&
                    Object.keys(values).length === 0
                )
                    return without(rows, ref);
                return { ...rows, [ref]: { ...current, values } };
            }),
        addRow: (connectionId, table) => {
            const ref = newRef();
            patch(connectionId, table, (rows) => ({
                ...rows,
                [ref]: { kind: 'insert', ref, values: {} },
            }));
            return ref;
        },
        markDelete: (connectionId, table, row) =>
            patch(connectionId, table, (rows) => {
                const current = rows[row.ref];
                if (current?.kind === 'insert') return without(rows, row.ref);
                if (current?.kind === 'delete' || !row.id) return rows;
                return {
                    ...rows,
                    [row.ref]: {
                        kind: 'delete',
                        ref: row.ref,
                        id: current?.id ?? row.id,
                        original: current?.original ?? row.original,
                        shortened: current?.shortened ?? row.shortened ?? [],
                        ...(current ? { edits: current.values } : {}),
                    },
                };
            }),
        unmarkDelete: (connectionId, table, ref) =>
            patch(connectionId, table, (rows) => {
                const current = rows[ref];
                if (current?.kind !== 'delete') return rows;
                if (!current.edits || Object.keys(current.edits).length === 0)
                    return without(rows, ref);
                return {
                    ...rows,
                    [ref]: {
                        kind: 'update',
                        ref,
                        id: current.id,
                        original: current.original,
                        shortened: current.shortened,
                        values: current.edits,
                    },
                };
            }),
        discard: (connectionId, table) =>
            patch(connectionId, table, (rows) =>
                Object.keys(rows).length === 0 ? rows : {},
            ),
        count: (connectionId, table) =>
            pendingCounts(get().byTable[pendingKey(connectionId, table)] ?? {}),
    };
});

export function pendingCounts(rows: Record<RowRef, PendingRow>): PendingCounts {
    const counts = { inserted: 0, updated: 0, deleted: 0 };
    for (const row of Object.values(rows)) {
        if (row.kind === 'insert') counts.inserted++;
        else if (row.kind === 'update') counts.updated++;
        else counts.deleted++;
    }
    return counts;
}

/** The refs of `toChanges(pending)`, in the same order: changes[i] belongs to changeRefs(pending)[i]. */
export const changeRefs = (pending: Record<RowRef, PendingRow>): RowRef[] =>
    Object.keys(pending);

const pick = (
    from: Record<string, QueryCell>,
    columns: string[],
): Record<string, QueryCell> =>
    Object.fromEntries(
        columns.filter((c) => c in from).map((c) => [c, from[c]]),
    );

/**
 * The change-set request for the pending rows, exactly as the server validates it (ChangeSetBuilder). Rows pinned by
 * ctid send every exact original (the server checks each comparable column) and list their shortened cells; rows
 * pinned by key, rowid or all values send only the originals of the columns they write (the optimistic check).
 * The server orders statements itself (deletes, updates, inserts); an error's index is a position in this list.
 */
export function toChanges(
    pending: Record<RowRef, PendingRow>,
): ChangeRequest[] {
    return changeRefs(pending).map((ref): ChangeRequest => {
        const row = pending[ref];
        if (row.kind === 'insert') return { op: 'insert', values: row.values };
        const ctid = 'ctid' in row.id;
        const original = ctid
            ? row.original
            : row.kind === 'update'
              ? pick(row.original, Object.keys(row.values))
              : {};
        const shortened =
            ctid && row.shortened.length > 0
                ? { shortened: row.shortened }
                : {};
        return row.kind === 'update'
            ? {
                  op: 'update',
                  id: row.id,
                  original,
                  values: row.values,
                  ...shortened,
              }
            : { op: 'delete', id: row.id, original, ...shortened };
    });
}
