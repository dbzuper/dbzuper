import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { nodeId, openRoot } from './trail';
import type {
    RecordPayload,
    RelatedPayload,
    RelationshipSummary,
} from './types';

const api = vi.hoisted(() => ({ show: vi.fn(), related: vi.fn() }));
vi.mock('./records-api', () => ({ recordsApi: api }));

import { TRAIL_FULL_NOTICE, clusterKey, useRecords } from './records-store';

const s = () => useRecords.getState();
const col = [
    { name: 'id', type: 'int' },
    { name: 'name', type: 'varchar' },
];
const payload = (table: string, id: number): RecordPayload => ({
    table,
    key: { id },
    columns: col,
    values: [id, `${table} ${id}`],
    relationships: [],
});
const rows = (from: number, n: number): RelatedPayload['rows'] =>
    Array.from({ length: n }, (_, i) => ({
        key: { id: from + i },
        values: [from + i, `item ${from + i}`],
    }));
const related = (
    table: string,
    r: RelatedPayload['rows'],
    next: string | null,
): RelatedPayload => ({
    table,
    columns: col,
    primary_key: ['id'],
    rows: r,
    next_cursor: next,
});
const inSummary: RelationshipSummary = {
    id: 'fk_items_order',
    direction: 'in',
    table: 'items',
    columns: ['order_id'],
    other_columns: ['id'],
    inferred: false,
    available: true,
    count: { value: 30, capped: false },
};
const outSummary: RelationshipSummary = {
    id: 'fk_orders_user',
    direction: 'out',
    table: 'users',
    columns: ['user_id'],
    other_columns: ['id'],
    inferred: false,
    available: true,
    count: { value: 1, capped: false },
};
const root = nodeId('orders', { id: 1 });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    vi.resetAllMocks();
    s().reset();
    s().setConnection(7);
    api.show.mockImplementation(
        (_c: number, table: string, key: { id: number }) =>
            Promise.resolve(payload(table, key.id)),
    );
});

describe('open', () => {
    it('creates the root and stores its payload', async () => {
        s().open('orders', { id: 1 });
        expect(s().trail.nodes).toHaveLength(1);
        expect(s().trail.selected).toBe(root);
        expect(s().records[root].status).toBe('loading');
        await vi.waitFor(() => expect(s().records[root].status).toBe('ready'));
        expect(s().records[root].payload?.values[1]).toBe('orders 1');
        expect(api.show.mock.calls[0].slice(0, 3)).toEqual([
            7,
            'orders',
            { id: 1 },
        ]);
    });

    it('marks a 404 root as missing', async () => {
        api.show.mockRejectedValue(new ApiError(404, {}));
        s().open('orders', { id: 1 });
        await vi.waitFor(() =>
            expect(s().records[root].status).toBe('missing'),
        );
    });

    it('turns a 422 into a notice and leaves no trail', async () => {
        api.show.mockRejectedValue(
            new ApiError(422, {
                error: {
                    kind: 'unknown',
                    reason: 'no_primary_key',
                    message:
                        'logs has no primary key; open it in the Data tab instead.',
                },
            }),
        );
        s().open('logs', { id: 1 });
        await vi.waitFor(() =>
            expect(s().notice).toBe(
                'logs has no primary key; open it in the Data tab instead.',
            ),
        );
        expect(s().trail.nodes).toEqual([]);
    });

    it('does nothing without a connection', () => {
        s().reset();
        s().open('orders', { id: 1 });
        expect(api.show).not.toHaveBeenCalled();
        expect(s().trail.nodes).toEqual([]);
    });
});

describe('expand and more', () => {
    beforeEach(async () => {
        s().open('orders', { id: 1 });
        await vi.waitFor(() => expect(s().records[root].status).toBe('ready'));
        api.show.mockClear();
    });

    it('adds 25 nodes, edges and a cluster, then more finishes it', async () => {
        api.related
            .mockResolvedValueOnce(related('items', rows(1, 25), 'c1'))
            .mockResolvedValueOnce(related('items', rows(26, 5), null));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(26));
        expect(s().trail.edges).toHaveLength(25);
        const key = clusterKey(root, inSummary.id, 'in');
        expect(s().clusters[key]).toMatchObject({
            table: 'items',
            remaining: 5,
            cursor: 'c1',
        });
        expect(api.related.mock.calls[0][3]).toMatchObject({
            rel: inSummary.id,
            dir: 'in',
            limit: 25,
            cursor: null,
        });
        // New cards render from the related row before their record arrives.
        const first = nodeId('items', { id: 1 });
        expect(s().records[first].preview?.values).toEqual([1, 'item 1']);

        s().more(key);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(31));
        expect(api.related.mock.calls[1][3].cursor).toBe('c1');
        expect(s().clusters[key]).toBeUndefined();
    });

    it('adds the single parent for an outgoing summary', async () => {
        api.related.mockResolvedValue(
            related('users', [{ key: { id: 9 }, values: [9, 'Ada'] }], null),
        );
        s().expand(root, outSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(2));
        expect(s().trail.edges).toEqual([
            {
                from: root,
                to: nodeId('users', { id: 9 }),
                rel: outSummary.id,
                dir: 'out',
            },
        ]);
        expect(Object.keys(s().clusters)).toEqual([]);
    });

    it('does not duplicate nodes when the same relationship is expanded twice', async () => {
        api.related.mockResolvedValue(related('items', rows(1, 3), null));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(4));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(api.related).toHaveBeenCalledTimes(2));
        await flush();
        expect(s().trail.nodes).toHaveLength(4);
        expect(s().trail.edges).toHaveLength(3);
    });

    it('ignores a repeated click while a page is in flight', async () => {
        api.related.mockReturnValue(new Promise(() => undefined));
        s().expand(root, inSummary);
        s().expand(root, inSummary);
        expect(api.related).toHaveBeenCalledTimes(1);
    });

    it('ignores a response that arrives after the trail was replaced', async () => {
        let resolve!: (p: RelatedPayload) => void;
        api.related.mockReturnValue(
            new Promise<RelatedPayload>((r) => {
                resolve = r;
            }),
        );
        s().expand(root, inSummary);
        s().open('users', { id: 5 });
        resolve(related('items', rows(1, 3), 'c'));
        await flush();
        await flush();
        expect(s().trail.nodes.map((n) => n.table)).toEqual(['users']);
        expect(s().trail.edges).toEqual([]);
        expect(s().clusters).toEqual({});
    });

    it('ignores a response for the same card after the trail was reopened on it', async () => {
        let resolve!: (p: RelatedPayload) => void;
        api.related.mockReturnValue(
            new Promise<RelatedPayload>((r) => {
                resolve = r;
            }),
        );
        s().expand(root, inSummary);
        s().open('orders', { id: 1 });
        resolve(related('items', rows(1, 3), 'c'));
        await flush();
        await flush();
        expect(s().trail.nodes).toHaveLength(1);
        expect(s().clusters).toEqual({});
    });

    it('fetches new nodes lazily with at most four requests at once', async () => {
        let active = 0;
        let peak = 0;
        const gates: (() => void)[] = [];
        api.show.mockImplementation(
            (_c: number, table: string, key: { id: number }) =>
                new Promise((resolve) => {
                    active += 1;
                    peak = Math.max(peak, active);
                    gates.push(() => {
                        active -= 1;
                        resolve(payload(table, key.id));
                    });
                }),
        );
        api.related.mockResolvedValue(related('items', rows(1, 10), null));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(11));
        // Cards exist at once; records trickle in.
        expect(api.show).toHaveBeenCalledTimes(4);
        for (let i = 0; i < 10; i++) {
            await vi.waitFor(() => expect(gates.length).toBeGreaterThan(i));
            gates[i]();
            await flush();
        }
        await vi.waitFor(() => expect(api.show).toHaveBeenCalledTimes(10));
        expect(peak).toBeLessThanOrEqual(4);
        await vi.waitFor(() =>
            expect(
                Object.values(s().records).every((r) => r.status === 'ready'),
            ).toBe(true),
        );
    });

    it('sets the full-trail notice at MAX_NODES', async () => {
        api.related
            .mockResolvedValueOnce(related('items', rows(1, 99), null))
            .mockResolvedValueOnce(related('items', rows(100, 5), null));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(100));
        expect(s().notice).toBeNull();
        s().expand(root, { ...inSummary, id: 'other' });
        await vi.waitFor(() => expect(s().notice).toBe(TRAIL_FULL_NOTICE));
        expect(s().trail.nodes).toHaveLength(100);
    });

    it('reports a failed page as a notice and unlocks the cluster', async () => {
        api.related.mockRejectedValue(new ApiError(500, {}));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().notice).not.toBeNull());
        api.related.mockResolvedValue(related('items', rows(1, 1), null));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(2));
    });
});

describe('trail management', () => {
    it('setTrail replaces the trail and loads every node', async () => {
        const trail = openRoot('orders', { id: 1 });
        s().setTrail({
            nodes: [
                ...trail.nodes,
                {
                    id: nodeId('users', { id: 2 }),
                    table: 'users',
                    key: { id: 2 },
                },
            ],
            edges: [],
            selected: trail.selected,
        });
        await vi.waitFor(() => expect(api.show).toHaveBeenCalledTimes(2));
        await vi.waitFor(() =>
            expect(
                Object.values(s().records).every((r) => r.status === 'ready'),
            ).toBe(true),
        );
    });

    it('remove drops a card and what is only reachable through it', async () => {
        s().open('orders', { id: 1 });
        await vi.waitFor(() => expect(s().records[root].status).toBe('ready'));
        api.related.mockResolvedValue(related('items', rows(1, 2), null));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(3));
        s().remove(nodeId('items', { id: 1 }));
        expect(s().trail.nodes).toHaveLength(2);
        expect(s().trail.edges).toHaveLength(1);
        s().remove(root);
        expect(s().trail.nodes).toEqual([]);
    });

    it('select and dismissNotice update the state', async () => {
        s().open('orders', { id: 1 });
        s().select('nope');
        expect(s().trail.selected).toBe(root);
        s().dismissNotice();
        expect(s().notice).toBeNull();
    });
});

describe('trail replacement and removal', () => {
    const item = (n: number) => nodeId('items', { id: n });
    const openAndLoad = async () => {
        s().open('orders', { id: 1 });
        await vi.waitFor(() => expect(s().records[root].status).toBe('ready'));
        api.show.mockClear();
    };

    it('setTrail keeps loaded nodes and fetches only the new one', async () => {
        await openAndLoad();
        const trail = openRoot('orders', { id: 1 });
        s().setTrail({
            nodes: [
                ...trail.nodes,
                { id: item(5), table: 'items', key: { id: 5 } },
            ],
            edges: [{ from: root, to: item(5), rel: 'fk', dir: 'in' }],
            selected: root,
        });
        expect(s().records[root].status).toBe('ready');
        await vi.waitFor(() =>
            expect(s().records[item(5)].status).toBe('ready'),
        );
        expect(api.show).toHaveBeenCalledTimes(1);
        expect(api.show.mock.calls[0][1]).toBe('items');
    });

    it('setTrail keeps clusters whose edge survives and drops the rest', async () => {
        await openAndLoad();
        api.related.mockResolvedValue(related('items', rows(1, 2), 'c'));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(3));
        const key = clusterKey(root, inSummary.id, 'in');
        const keep = structuredClone(s().trail);
        s().setTrail(keep);
        expect(s().clusters[key]).toBeDefined();
        s().setTrail(openRoot('orders', { id: 1 }));
        expect(s().clusters).toEqual({});
    });

    it('does not start a second request for a node already loading', async () => {
        await openAndLoad();
        api.show.mockReturnValue(new Promise(() => undefined));
        s().reload(root);
        s().reload(root);
        s().reload(root);
        expect(api.show).toHaveBeenCalledTimes(1);
    });

    it('keeps the cursor and the cluster when the node cap refuses rows', async () => {
        await openAndLoad();
        api.related
            .mockResolvedValueOnce(related('items', rows(1, 99), null))
            .mockResolvedValueOnce(related('items', rows(100, 5), 'next'));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(100));
        const other = { ...inSummary, id: 'other' };
        s().expand(root, other);
        await vi.waitFor(() => expect(s().notice).toBe(TRAIL_FULL_NOTICE));
        const cluster = s().clusters[clusterKey(root, 'other', 'in')];
        expect(cluster).toBeDefined();
        expect(cluster.cursor).toBeNull();
    });

    it('a failing record does not stall the queue', async () => {
        await openAndLoad();
        let n = 0;
        api.show.mockImplementation(
            (_c: number, table: string, key: { id: number }) =>
                ++n === 1
                    ? Promise.reject(new ApiError(500, {}))
                    : Promise.resolve(payload(table, key.id)),
        );
        api.related.mockResolvedValue(related('items', rows(1, 9), null));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(api.show).toHaveBeenCalledTimes(9));
        await vi.waitFor(() =>
            expect(
                Object.values(s().records).filter((r) => r.status === 'ready'),
            ).toHaveLength(9),
        );
        expect(s().records[item(1)].status).toBe('error');
    });

    it('queued record fetches of a replaced trail never start', async () => {
        await openAndLoad();
        const gates: (() => void)[] = [];
        api.show.mockImplementation(
            (_c: number, table: string, key: { id: number }) =>
                new Promise((resolve) =>
                    gates.push(() => resolve(payload(table, key.id))),
                ),
        );
        api.related.mockResolvedValue(related('items', rows(1, 10), null));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(api.show).toHaveBeenCalledTimes(4));
        api.show.mockImplementation(
            (_c: number, table: string, key: { id: number }) =>
                Promise.resolve(payload(table, key.id)),
        );
        s().open('users', { id: 5 });
        gates.forEach((g) => g());
        await flush();
        await flush();
        // 4 in flight + the new root; the 6 queued ones were dropped.
        expect(api.show).toHaveBeenCalledTimes(5);
        expect(s().trail.nodes).toHaveLength(1);
    });

    it('more after the trail was replaced is ignored', async () => {
        await openAndLoad();
        api.related.mockResolvedValue(related('items', rows(1, 25), 'c1'));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(26));
        const key = clusterKey(root, inSummary.id, 'in');
        s().open('users', { id: 5 });
        api.related.mockClear();
        s().more(key);
        expect(api.related).not.toHaveBeenCalled();
    });

    it('removing a card during its in-flight expand creates no cluster or nodes', async () => {
        await openAndLoad();
        api.related.mockResolvedValueOnce(related('items', rows(1, 2), null));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(3));
        let resolve!: (p: RelatedPayload) => void;
        api.related.mockReturnValue(
            new Promise<RelatedPayload>((r) => {
                resolve = r;
            }),
        );
        s().expand(item(1), { ...outSummary, id: 'x', direction: 'in' });
        s().remove(item(1));
        resolve(related('sub', rows(50, 30), 'more'));
        await flush();
        await flush();
        expect(s().trail.nodes).toHaveLength(2);
        expect(Object.keys(s().clusters)).toEqual([]);
    });

    it('a record response for a removed card is not stored', async () => {
        await openAndLoad();
        let resolve!: (p: RecordPayload) => void;
        api.show.mockReturnValue(
            new Promise<RecordPayload>((r) => {
                resolve = r;
            }),
        );
        api.related.mockResolvedValue(related('items', rows(1, 2), null));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(3));
        s().remove(item(1));
        resolve(payload('items', 1));
        await flush();
        await flush();
        expect(s().records[item(1)]).toBeUndefined();
    });

    it('a page requested before setTrail does not apply to the restored trail', async () => {
        await openAndLoad();
        let resolve!: (p: RelatedPayload) => void;
        api.related.mockReturnValue(
            new Promise<RelatedPayload>((r) => {
                resolve = r;
            }),
        );
        s().expand(root, inSummary);
        s().setTrail(openRoot('orders', { id: 1 }));
        resolve(related('items', rows(1, 3), 'c'));
        await flush();
        await flush();
        expect(s().trail.nodes).toHaveLength(1);
        expect(s().clusters).toEqual({});
    });

    it('aborts removed-source page requests even when the rel id contains a pipe', async () => {
        await openAndLoad();
        api.related.mockResolvedValueOnce(related('items', rows(1, 1), null));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(2));
        let signal!: AbortSignal;
        api.related.mockImplementation(
            (
                _c: number,
                _t: string,
                _k: unknown,
                _p: unknown,
                sig: AbortSignal,
            ) => {
                signal = sig;
                return new Promise(() => undefined);
            },
        );
        s().expand(item(1), { ...inSummary, id: 'a|b', direction: 'in' });
        s().remove(item(1));
        expect(signal.aborted).toBe(true);
    });

    it('recomputes the remaining count of kept clusters against the new trail', async () => {
        await openAndLoad();
        api.related.mockResolvedValue(related('items', rows(1, 25), 'c1'));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(26));
        const key = clusterKey(root, inSummary.id, 'in');
        expect(s().clusters[key].remaining).toBe(5);
        const t = structuredClone(s().trail);
        t.nodes = t.nodes.slice(0, 11);
        t.edges = t.edges.slice(0, 10);
        s().setTrail(t);
        expect(s().clusters[key].remaining).toBe(20);
        expect(s().clusters[key].loading).toBe(false);
    });

    it('drops a stale cursor after setTrail so no rows are skipped', async () => {
        await openAndLoad();
        api.related.mockResolvedValue(related('items', rows(1, 25), 'c1'));
        s().expand(root, inSummary);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(26));
        const key = clusterKey(root, inSummary.id, 'in');
        const t = structuredClone(s().trail);
        t.nodes = t.nodes.slice(0, 11);
        t.edges = t.edges.slice(0, 10);
        s().setTrail(t);
        expect(s().clusters[key].cursor).toBeNull();
        api.related
            .mockClear()
            .mockResolvedValueOnce(related('items', rows(1, 25), 'c2'));
        s().more(key);
        await vi.waitFor(() => expect(s().trail.nodes).toHaveLength(26));
        expect(api.related.mock.calls[0][3].cursor).toBeNull();
        expect(new Set(s().trail.nodes.map((n) => n.id)).size).toBe(26);
        expect(s().clusters[key].cursor).toBe('c2');
        // An unchanged trail keeps its cursor.
        s().setTrail(structuredClone(s().trail));
        expect(s().clusters[key].cursor).toBe('c2');
    });
});
