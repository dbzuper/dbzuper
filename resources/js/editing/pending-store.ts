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

export type PendingDrop = { table: string; reason: 'table' | 'columns' };

type State = {
    /** By `${connectionId}:${table}`: every view (tab) of a table shares one set (spec §3, §4.4). */
    byTable: Record<string, Table>;
    /**
     * By the same key: why a row's change failed in the last commit (spec §4.1 red outline). A row's error goes
     * when its change is edited, reverted or discarded.
     */
    errors: Record<string, Record<RowRef, string>>;
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
    /** Drops a loaded row's pending update (every staged cell); a deleted row is restored with unmarkDelete. */
    revertRow(connectionId: number, table: string, ref: RowRef): void;
    /** Adds an empty new row (every column at its default) and returns its ref. */
    addRow(connectionId: number, table: string): RowRef;
    /** Marks a loaded row for deletion; a new row is simply removed. */
    markDelete(connectionId: number, table: string, row: PendingTarget): void;
    unmarkDelete(connectionId: number, table: string, ref: RowRef): void;
    discard(connectionId: number, table: string): void;
    /** After a commit of `committed`: removes those changes that are still exactly as committed; later ones stay. */
    settle(
        connectionId: number,
        table: string,
        committed: Record<RowRef, PendingRow>,
    ): void;
    /** Replaces the table's row errors (empty clears them). */
    setErrors(
        connectionId: number,
        table: string,
        errors: Record<RowRef, string>,
    ): void;
    /**
     * After a schema refresh (spec §4.4): drops a removed table's changes, and the changes that write or are pinned
     * by a removed column; other changes forget the column. Returns each table whose changes were affected. Only
     * the tables `include` accepts are touched (all when it is left out).
     */
    reconcile(
        connectionId: number,
        tables: Map<string, string[]>,
        include?: (table: string) => boolean,
    ): PendingDrop[];
    count(connectionId: number, table: string): PendingCounts;
};

export const pendingKey = (connectionId: number, table: string) =>
    `${connectionId}:${table}`;

/** The ref of a loaded row: its identity as JSON (the server always sends identity keys in one order). */
export const refOf = (id: RowIdentity): RowRef => JSON.stringify(id);

/**
 * The refs of a response's rows, parallel to `rowIds`. Rows with the same identity (identical rows of a MySQL/MariaDB
 * table without a key) each get their own ref, `<identity JSON>#<n>` for the n-th repeat in the response, while
 * sharing the identity: each staged change still affects one of them (`LIMIT 1`).
 */
export function rowRefs(rowIds: (RowIdentity | null)[]): (RowRef | null)[] {
    const cached = refCache.get(rowIds);
    if (cached) return cached;
    const seen = new Map<string, number>();
    const refs = rowIds.map((id) => {
        if (!id) return null;
        const base = refOf(id);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        return n === 0 ? base : `${base}#${n}`;
    });
    refCache.set(rowIds, refs);
    return refs;
}

const refCache = new WeakMap<(RowIdentity | null)[], (RowRef | null)[]>();

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
                errors: keepErrors(s.errors, key, before, after),
            };
        });

    return {
        byTable: {},
        errors: {},
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
        revertRow: (connectionId, table, ref) =>
            patch(connectionId, table, (rows) =>
                rows[ref]?.kind === 'update' ? without(rows, ref) : rows,
            ),
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
        settle: (connectionId, table, committed) =>
            patch(connectionId, table, (rows) => {
                // By identity, and structurally as a second guard: a schema refresh during the commit rebuilds
                // row objects, and a committed change must never stay pending (it would be committed twice).
                const left = Object.fromEntries(
                    Object.entries(rows).filter(
                        ([ref, row]) => !sameChange(committed[ref], row),
                    ),
                );
                return Object.keys(left).length === Object.keys(rows).length
                    ? rows
                    : left;
            }),
        discard: (connectionId, table) =>
            patch(connectionId, table, (rows) =>
                Object.keys(rows).length === 0 ? rows : {},
            ),
        setErrors: (connectionId, table, errors) =>
            set((s) => {
                const key = pendingKey(connectionId, table);
                if (Object.keys(errors).length > 0)
                    return { errors: { ...s.errors, [key]: errors } };
                return key in s.errors ? { errors: without(s.errors, key) } : s;
            }),
        reconcile: (connectionId, tables, include) => {
            const dropped: PendingDrop[] = [];
            const prefix = `${connectionId}:`;
            const s = get();
            let byTable = s.byTable;
            let errors = s.errors;
            for (const [key, rows] of Object.entries(s.byTable)) {
                if (!key.startsWith(prefix)) continue;
                const table = key.slice(prefix.length);
                if (include && !include(table)) continue;
                const columns = tables.get(table);
                const fit = columns
                    ? fitRows(rows, new Set(columns))
                    : { rows: {}, lost: true };
                const next = fit.rows;
                if (next === rows) continue;
                // Only a change (or a staged value) that is gone is worth a toast, not a forgotten original.
                if (fit.lost)
                    dropped.push({
                        table,
                        reason: columns ? 'columns' : 'table',
                    });
                errors = keepErrors(errors, key, rows, next);
                byTable =
                    Object.keys(next).length === 0
                        ? without(byTable, key)
                        : { ...byTable, [key]: next };
            }
            if (byTable !== s.byTable) set({ byTable, errors });
            return dropped;
        },
        count: (connectionId, table) =>
            pendingCounts(get().byTable[pendingKey(connectionId, table)] ?? {}),
    };
});

/** Whether two plain JSON-like values are equal, key order aside. */
function sameJson(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (
        typeof a !== 'object' ||
        typeof b !== 'object' ||
        a === null ||
        b === null ||
        Array.isArray(a) !== Array.isArray(b)
    )
        return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
        ka.length === kb.length &&
        ka.every(
            (k) =>
                Object.prototype.hasOwnProperty.call(b, k) &&
                sameJson(
                    (a as Record<string, unknown>)[k],
                    (b as Record<string, unknown>)[k],
                ),
        )
    );
}

/** Whether `row` is still the change that was committed: the same object, or the same op, identity and values. */
function sameChange(committed: PendingRow | undefined, row: PendingRow) {
    if (!committed) return false;
    if (committed === row) return true;
    if (committed.kind !== row.kind || committed.ref !== row.ref) return false;
    if (row.kind === 'insert')
        return sameJson((committed as typeof row).values, row.values);
    const c = committed as Exclude<PendingRow, { kind: 'insert' }>;
    return (
        sameJson(c.id, row.id) &&
        (row.kind === 'delete' ||
            sameJson((c as typeof row).values, row.values))
    );
}

/** The table's errors without those of rows whose change is gone or changed. */
function keepErrors(
    errors: State['errors'],
    key: string,
    before: Table,
    after: Table,
): State['errors'] {
    const current = errors[key];
    if (!current) return errors;
    const kept = Object.fromEntries(
        Object.entries(current).filter(
            ([ref]) => after[ref] !== undefined && after[ref] === before[ref],
        ),
    );
    if (Object.keys(kept).length === Object.keys(current).length) return errors;
    return Object.keys(kept).length === 0
        ? without(errors, key)
        : { ...errors, [key]: kept };
}

const keep = <V>(
    map: Record<string, V>,
    columns: Set<string>,
): Record<string, V> => {
    const removed = Object.keys(map).filter((c) => !columns.has(c));
    if (removed.length === 0) return map;
    let next = map;
    for (const c of removed) next = without(next, c);
    return next;
};

/** The id names columns: by key or by all values. */
const idColumns = (id: RowIdentity): string[] =>
    'key' in id
        ? Object.keys(id.key)
        : 'values' in id
          ? Object.keys(id.values)
          : [];

/** The rows as they fit `columns`; the same object when all of them already do. */
function fitRows(
    rows: Table,
    columns: Set<string>,
): { rows: Table; lost: boolean } {
    let changed = false;
    /** A change, a staged value or a delete's kept edits was dropped. */
    let lost = false;
    const next: Table = {};
    for (const [ref, row] of Object.entries(rows)) {
        let fitted: PendingRow | null = row;
        if (row.kind === 'insert') {
            const values = keep(row.values, columns);
            if (values !== row.values) {
                fitted = { ...row, values };
                lost = true;
            }
        } else if (
            idColumns(row.id).some((c) => !columns.has(c)) ||
            (row.kind === 'update' &&
                Object.keys(row.values).some((c) => !columns.has(c)))
        ) {
            fitted = null;
            lost = true;
        } else {
            const original = keep(row.original, columns);
            const shortened = row.shortened.filter((c) => columns.has(c));
            const edits =
                row.kind === 'delete' && row.edits
                    ? keep(row.edits, columns)
                    : undefined;
            if (
                original !== row.original ||
                shortened.length !== row.shortened.length ||
                (row.kind === 'delete' && edits !== row.edits)
            ) {
                if (row.kind === 'delete' && edits !== row.edits) lost = true;
                fitted = {
                    ...row,
                    original,
                    shortened,
                    ...(edits ? { edits } : {}),
                };
            }
        }
        if (fitted !== row) changed = true;
        if (fitted) next[ref] = fitted;
    }
    return { rows: changed ? next : rows, lost };
}

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
