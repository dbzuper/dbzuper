import { beforeEach, describe, expect, it } from 'vitest';
import {
    changeRefs,
    pendingCounts,
    refOf,
    rowRefs,
    toChanges,
    usePending,
    type PendingRow,
} from './pending-store';

const C = 1;
const T = 'orders';
const row = (id: number) => ({
    ref: refOf({ key: { id } }),
    id: { key: { id } },
    original: { id, status: 'open', note: 'hi', paid: true },
});

const pending = () => usePending.getState().byTable[`${C}:${T}`] ?? {};

beforeEach(() => usePending.setState({ byTable: {}, errors: {} }));

describe('usePending', () => {
    it('stages a cell edit and removes it when set back to the original', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(1), 'status', 'paid');
        expect(pending()[row(1).ref]).toEqual({
            kind: 'update',
            ref: row(1).ref,
            id: { key: { id: 1 } },
            original: row(1).original,
            shortened: [],
            values: { status: 'paid' },
        });
        s.setCell(C, T, row(1), 'note', null);
        s.setCell(C, T, row(1), 'status', 'open');
        expect(pending()[row(1).ref]).toMatchObject({
            values: { note: null },
        });
        s.setCell(C, T, row(1), 'note', 'hi');
        // An update with nothing left is no change at all.
        expect(pending()).toEqual({});
    });

    it('compares numbers and booleans to their text form', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(1), 'id', '1');
        s.setCell(C, T, row(1), 'paid', 'true');
        expect(pending()).toEqual({});
        s.setCell(C, T, row(1), 'paid', '0');
        expect(pending()[row(1).ref]).toMatchObject({ values: { paid: '0' } });
        s.setCell(C, T, row(1), 'paid', '1');
        expect(pending()).toEqual({});
    });

    it('compares with the original stored with the change, not a later load', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(1), 'status', 'paid');
        // A refetch shows another value; the change still belongs to what was loaded first.
        const reloaded = {
            ...row(1),
            original: { ...row(1).original, status: 'shipped' },
        };
        s.setCell(C, T, reloaded, 'note', 'x');
        expect(pending()[row(1).ref]).toMatchObject({
            original: { status: 'open' },
        });
        s.setCell(C, T, reloaded, 'status', 'open');
        expect(pending()[row(1).ref]).toMatchObject({ values: { note: 'x' } });
        expect(pending()[row(1).ref]).not.toHaveProperty('values.status');
    });

    it('keeps an empty string distinct from NULL', () => {
        const s = usePending.getState();
        s.setCell(C, T, { ...row(1), original: { note: null } }, 'note', '');
        expect(pending()[row(1).ref]).toMatchObject({ values: { note: '' } });
    });

    it('reverts one cell', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(1), 'status', 'paid');
        s.setCell(C, T, row(1), 'note', 'x');
        s.revertCell(C, T, row(1).ref, 'status');
        expect(pending()[row(1).ref]).toMatchObject({ values: { note: 'x' } });
        s.revertCell(C, T, row(1).ref, 'note');
        expect(pending()).toEqual({});
    });

    it('reverts a whole edited row, and leaves a deleted one to Restore', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(1), 'status', 'paid');
        s.setCell(C, T, row(1), 'note', 'x');
        s.revertRow(C, T, row(1).ref);
        expect(pending()).toEqual({});
        s.markDelete(C, T, row(2));
        const before = pending();
        s.revertRow(C, T, row(2).ref);
        expect(pending()).toBe(before);
    });

    it('adds new rows and removes one that is deleted', () => {
        const s = usePending.getState();
        const a = s.addRow(C, T);
        const b = s.addRow(C, T);
        expect(a).toMatch(/^new:/);
        expect(a).not.toBe(b);
        s.setCell(C, T, { ref: a, id: null, original: {} }, 'status', 'new');
        expect(pending()[a]).toEqual({
            kind: 'insert',
            ref: a,
            values: { status: 'new' },
        });
        s.revertCell(C, T, a, 'status');
        // A new row stays, back to its defaults.
        expect(pending()[a]).toEqual({ kind: 'insert', ref: a, values: {} });
        s.markDelete(C, T, { ref: a, id: null, original: {} });
        expect(Object.keys(pending())).toEqual([b]);
    });

    it('marks a row for deletion and unmarks it with its edits intact', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(2), 'status', 'paid');
        s.markDelete(C, T, row(2));
        expect(pending()[row(2).ref]).toMatchObject({
            kind: 'delete',
            id: { key: { id: 2 } },
        });
        // A deleted row isn't edited.
        s.setCell(C, T, row(2), 'note', 'x');
        expect(pending()[row(2).ref].kind).toBe('delete');
        s.unmarkDelete(C, T, row(2).ref);
        expect(pending()[row(2).ref]).toMatchObject({
            kind: 'update',
            values: { status: 'paid' },
        });
        s.markDelete(C, T, row(3));
        s.unmarkDelete(C, T, row(3).ref);
        expect(pending()[row(3).ref]).toBeUndefined();
    });

    it('is shared by every view of a table and kept apart per table and connection', () => {
        const s = usePending.getState();
        // Two views (`orders`, `orders (2)`) write through the same table key.
        s.setCell(C, T, row(1), 'status', 'a');
        s.setCell(C, T, row(2), 'status', 'b');
        s.setCell(C, 'users', row(1), 'status', 'c');
        s.setCell(2, T, row(1), 'status', 'd');
        expect(Object.keys(pending())).toHaveLength(2);
        expect(s.count(C, T)).toEqual({ inserted: 0, updated: 2, deleted: 0 });
        s.discard(C, T);
        expect(pending()).toEqual({});
        expect(s.count(C, 'users').updated).toBe(1);
        expect(s.count(2, T).updated).toBe(1);
    });

    it('counts new, edited and deleted rows', () => {
        const s = usePending.getState();
        s.addRow(C, T);
        s.addRow(C, T);
        s.setCell(C, T, row(1), 'status', 'paid');
        s.markDelete(C, T, row(2));
        expect(s.count(C, T)).toEqual({ inserted: 2, updated: 1, deleted: 1 });
        expect(pendingCounts(pending())).toEqual({
            inserted: 2,
            updated: 1,
            deleted: 1,
        });
    });

    it('returns the same table map until it changes', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(1), 'status', 'paid');
        const before = pending();
        s.setCell(C, 'users', row(1), 'status', 'x');
        expect(pending()).toBe(before);
    });
});

describe('toChanges', () => {
    const pk = (n: number): PendingRow => ({
        kind: 'update',
        ref: refOf({ key: { id: n } }),
        id: { key: { id: n } },
        original: { id: n, status: 'open', note: 'hi' },
        shortened: [],
        values: { status: 'paid' },
    });

    it('maps each pending row to its change, whatever order it was staged in', () => {
        const insert: PendingRow = {
            kind: 'insert',
            ref: 'new:a',
            values: { status: 'new' },
        };
        const del: PendingRow = {
            kind: 'delete',
            ref: refOf({ key: { id: 9 } }),
            id: { key: { id: 9 } },
            original: { id: 9, status: 'x', note: 'y' },
            shortened: [],
        };
        const expected = [
            { op: 'insert', values: { status: 'new' } },
            {
                op: 'update',
                id: { key: { id: 1 } },
                // Key-pinned rows send only the originals of the columns they write.
                original: { status: 'open' },
                values: { status: 'paid' },
            },
            { op: 'delete', id: { key: { id: 9 } }, original: {} },
        ];
        const a = { [insert.ref]: insert, [pk(1).ref]: pk(1), [del.ref]: del };
        const b = { [del.ref]: del, [pk(1).ref]: pk(1), [insert.ref]: insert };
        expect(toChanges(a)).toEqual(expected);
        expect(toChanges(b)).toEqual(expect.arrayContaining(expected));
        // changes[i] is the pending row changeRefs(...)[i]: a failing index maps back to its row.
        const refs = changeRefs(b);
        toChanges(b).forEach((change, i) =>
            expect(change.op).toBe(
                { insert: 'insert', update: 'update', delete: 'delete' }[
                    b[refs[i]].kind
                ],
            ),
        );
    });

    it('sends every exact original and lists shortened cells for ctid-pinned rows', () => {
        const id = { ctid: '(0,1)', xmin: '700', filenode: '16384' };
        const update: PendingRow = {
            kind: 'update',
            ref: refOf(id),
            id,
            original: { id: 7, body: 'x', price: 1.5, ok: false, gone: null },
            shortened: ['long_text', 'blob'],
            values: { body: 'y' },
        };
        expect(toChanges({ [update.ref]: update })).toEqual([
            {
                op: 'update',
                id,
                original: {
                    id: 7,
                    body: 'x',
                    price: 1.5,
                    ok: false,
                    gone: null,
                },
                values: { body: 'y' },
                shortened: ['long_text', 'blob'],
            },
        ]);
        const del: PendingRow = {
            kind: 'delete',
            ref: refOf(id),
            id,
            original: { id: 7 },
            shortened: [],
        };
        expect(toChanges({ [del.ref]: del })).toEqual([
            { op: 'delete', id, original: { id: 7 } },
        ]);
    });

    it('sends rowid and all-values identities with the originals they write', () => {
        const rowid: PendingRow = {
            kind: 'update',
            ref: refOf({ rowid: '3' }),
            id: { rowid: '3' },
            original: { a: 1, b: 'two' },
            shortened: [],
            values: { b: null },
        };
        const values: PendingRow = {
            kind: 'update',
            ref: refOf({ values: { a: 1, b: 'two' } }),
            id: { values: { a: 1, b: 'two' } },
            original: { a: 1, b: 'two' },
            shortened: [],
            values: { a: '2' },
        };
        expect(toChanges({ [rowid.ref]: rowid, [values.ref]: values })).toEqual(
            [
                {
                    op: 'update',
                    id: { rowid: '3' },
                    original: { b: 'two' },
                    values: { b: null },
                },
                {
                    op: 'update',
                    id: { values: { a: 1, b: 'two' } },
                    original: { a: 1 },
                    values: { a: '2' },
                },
            ],
        );
    });
});

describe('row errors after a failed commit', () => {
    const errors = () => usePending.getState().errors[`${C}:${T}`] ?? {};

    it('keeps an error until its row is edited, and drops all on discard', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(1), 'status', 'paid');
        s.setCell(C, T, row(2), 'status', 'paid');
        s.setErrors(C, T, {
            [row(1).ref]: 'row changed',
            [row(2).ref]: 'other',
        });
        expect(errors()).toEqual({
            [row(1).ref]: 'row changed',
            [row(2).ref]: 'other',
        });
        s.setCell(C, T, row(1), 'note', 'x');
        expect(errors()).toEqual({ [row(2).ref]: 'other' });
        s.discard(C, T);
        expect(usePending.getState().errors[`${C}:${T}`]).toBeUndefined();
    });

    it('drops the error of a reverted or unmarked row', () => {
        const s = usePending.getState();
        s.markDelete(C, T, row(1));
        s.setErrors(C, T, { [row(1).ref]: 'gone' });
        s.unmarkDelete(C, T, row(1).ref);
        expect(errors()).toEqual({});
    });

    it('replaces every earlier error of the table', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(1), 'status', 'paid');
        s.setErrors(C, T, { [row(1).ref]: 'a' });
        s.setErrors(C, T, {});
        expect(usePending.getState().errors[`${C}:${T}`]).toBeUndefined();
    });
});

describe('reconcile with a refreshed schema', () => {
    const tables = (entries: [string, string[]][]) => new Map(entries);

    it('drops every change of a removed table', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(1), 'status', 'paid');
        s.addRow(C, 'users');
        const dropped = s.reconcile(C, tables([['users', ['id']]]));
        expect(dropped).toEqual([{ table: T, reason: 'table' }]);
        expect(usePending.getState().byTable[`${C}:${T}`]).toBeUndefined();
        expect(usePending.getState().byTable[`${C}:users`]).toBeDefined();
    });

    it('drops the changes that write or pin a removed column, and strips it elsewhere', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(1), 'note', 'x'); // writes the removed column: dropped
        s.setCell(C, T, row(2), 'status', 'paid'); // kept, its stored original loses `note`
        const keyed = { key: { note: 'k' } };
        s.markDelete(C, T, { ref: refOf(keyed), id: keyed, original: {} }); // pinned by it: dropped
        const insert = s.addRow(C, T);
        s.setCell(C, T, { ref: insert, id: null, original: {} }, 'note', 'n');
        s.setCell(C, T, { ref: insert, id: null, original: {} }, 'status', 's');
        const dropped = s.reconcile(C, tables([[T, ['id', 'status', 'paid']]]));
        expect(dropped).toEqual([{ table: T, reason: 'columns' }]);
        const p = pending();
        expect(p[row(1).ref]).toBeUndefined();
        expect(p[refOf(keyed)]).toBeUndefined();
        expect(p[row(2).ref]).toMatchObject({
            kind: 'update',
            values: { status: 'paid' },
            original: { id: 2, status: 'open', paid: true },
        });
        expect(p[insert]).toEqual({
            kind: 'insert',
            ref: insert,
            values: { status: 's' },
        });
    });

    it('reports nothing and keeps the same map when the schema still fits', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(1), 'status', 'paid');
        const before = usePending.getState().byTable;
        expect(
            s.reconcile(C, tables([[T, ['id', 'status', 'note', 'paid']]])),
        ).toEqual([]);
        expect(usePending.getState().byTable).toBe(before);
    });

    it('forgets a removed column that only an original held, without reporting a drop', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(1), 'status', 'paid');
        expect(s.reconcile(C, tables([[T, ['id', 'status', 'paid']]]))).toEqual(
            [],
        );
        expect(pending()[row(1).ref]).toMatchObject({
            values: { status: 'paid' },
            original: { id: 1, status: 'open', paid: true },
        });
    });

    it('leaves other connections alone', () => {
        const s = usePending.getState();
        s.setCell(2, T, row(1), 'status', 'paid');
        expect(s.reconcile(C, tables([]))).toEqual([]);
        expect(usePending.getState().byTable[`2:${T}`]).toBeDefined();
    });
});

describe('settle after a commit', () => {
    it('removes the committed changes that are unchanged and keeps later ones', () => {
        const s = usePending.getState();
        s.setCell(C, T, row(1), 'status', 'paid');
        s.setCell(C, T, row(2), 'status', 'paid');
        const committed = pending();
        s.setCell(C, T, row(2), 'note', 'later');
        s.setCell(C, T, row(3), 'status', 'paid');
        s.settle(C, T, committed);
        expect(Object.keys(pending()).sort()).toEqual(
            [row(2).ref, row(3).ref].sort(),
        );
        s.settle(C, T, pending());
        expect(usePending.getState().byTable[`${C}:${T}`]).toBeUndefined();
    });
});

describe('rowRefs', () => {
    it('gives each identical row of a response its own ref, sharing the identity', () => {
        const dup = { values: { note: 'same', qty: 1 } };
        const other = { values: { note: 'other', qty: 2 } };
        expect(rowRefs([dup, other, dup, null, dup])).toEqual([
            refOf(dup),
            refOf(other),
            `${refOf(dup)}#1`,
            null,
            `${refOf(dup)}#2`,
        ]);
    });

    it('stages one delete per marked duplicate, each with the same identity', () => {
        const dup = { values: { note: 'same', qty: 1 } };
        const refs = rowRefs([dup, dup, dup]);
        const s = usePending.getState();
        for (const ref of [refs[0], refs[2]])
            s.markDelete(C, T, { ref: ref!, id: dup, original: {} });
        expect(s.count(C, T)).toEqual({ inserted: 0, updated: 0, deleted: 2 });
        expect(toChanges(pending())).toEqual([
            { op: 'delete', id: dup, original: {} },
            { op: 'delete', id: dup, original: {} },
        ]);
    });
});

describe('settle compares structurally as well', () => {
    it('removes a committed change whose object was replaced by an equal one (schema refresh)', () => {
        const s = usePending.getState();
        const ref = s.addRow(C, T);
        s.setCell(C, T, { ref, id: null, original: {} }, 'status', 'paid');
        s.setCell(C, T, row(1), 'status', 'paid');
        const committed = pending();
        // A refresh rebuilds the row objects without changing them.
        usePending.setState({
            byTable: {
                [`${C}:${T}`]: Object.fromEntries(
                    Object.entries(committed).map(([k, v]) => [
                        k,
                        structuredClone(v),
                    ]),
                ),
            },
        });
        s.settle(C, T, committed);
        expect(usePending.getState().byTable[`${C}:${T}`]).toBeUndefined();
    });

    it('keeps a change edited after the commit started', () => {
        const s = usePending.getState();
        const ref = s.addRow(C, T);
        s.setCell(C, T, { ref, id: null, original: {} }, 'status', 'paid');
        const committed = pending();
        s.setCell(C, T, { ref, id: null, original: {} }, 'status', 'later');
        s.settle(C, T, committed);
        expect(pending()[ref]).toMatchObject({ values: { status: 'later' } });
    });
});
