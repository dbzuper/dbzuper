import { create } from 'zustand';
import { ApiError } from '@/lib/http';
import { dbErrorFrom } from '@/lib/workspace-api';
import type { QueryCell } from '@/types/schema';
import { recordsApi } from './records-api';
import {
    addRelated,
    emptyTrail,
    MAX_NODES,
    nodeId,
    openRoot,
    select as selectNode,
    type Trail,
} from './trail';
import type {
    RecordKeyValues,
    RecordPayload,
    RelationshipSummary,
} from './types';

const PAGE = 25;
const CONCURRENCY = 4;

export const TRAIL_FULL_NOTICE = `Trail is full (${MAX_NODES} records). Close the explorer or start from another record.`;

/** What a card can draw before its own record has been fetched (taken from the related-rows payload). */
export type RecordPreview = {
    columns: { name: string; type: string }[];
    values: QueryCell[];
    primaryKey: string[];
};

export type RecordEntry = {
    status: 'loading' | 'ready' | 'missing' | 'error';
    payload?: RecordPayload;
    preview?: RecordPreview;
    error?: string;
};

export type ClusterState = {
    from: string;
    table: string;
    summary: RelationshipSummary;
    remaining: number | null;
    cursor: string | null;
    /** Edges from the source via this relationship that the cursor accounts for. */
    edgeCount: number;
    loading: boolean;
};

export const clusterKey = (from: string, rel: string, dir: 'out' | 'in') =>
    `${from}|${rel}|${dir}`;

type State = {
    connectionId: number | null;
    trail: Trail;
    records: Record<string, RecordEntry>;
    clusters: Record<string, ClusterState>;
    notice: string | null;
    /** A table the notice offers to open in the Data tab (it cannot be explored as records). */
    noticeTable: string | null;
    /** Bumped whenever the trail is replaced (open, setTrail, reset), so views can refit and drop drag state. */
    epoch: number;
    /** Bumped when the store itself empties the trail (a failed root), so the URL is rewritten, not pushed. */
    systemEpoch: number;
};

type Actions = {
    /** Which connection the actions talk to; switching connections clears the trail. */
    setConnection: (id: number | null) => void;
    /** Replaces the trail with a single root record and fetches it. */
    open: (table: string, key: RecordKeyValues) => void;
    /** Fetches the first related page of a relationship port and adds the nodes. */
    expand: (fromId: string, summary: RelationshipSummary) => void;
    /** Adds the next page of an already expanded cluster. */
    more: (key: string) => void;
    select: (id: string) => void;
    /** Removes a card (and anything only reachable through it). */
    remove: (id: string) => void;
    /** Fetches (again) the full record of a node. */
    reload: (id: string) => void;
    /** Replaces the whole trail (URL restore); nodes are fetched lazily. */
    setTrail: (trail: Trail) => void;
    dismissNotice: () => void;
    reset: () => void;
};

export type RecordsState = State & Actions;

const initial = (): State => ({
    connectionId: null,
    trail: emptyTrail(),
    records: {},
    clusters: {},
    notice: null,
    noticeTable: null,
    epoch: 0,
    systemEpoch: 0,
});

// Every async action captures the current "generation" and drops its result when the trail
// has been replaced in the meantime. The record queue lives with the generation too. In-flight
// requests are tracked per node id and per cluster key so duplicates are ignored and the
// requests of removed nodes can be aborted without touching the others.
type Queue = { active: number; pending: (() => void)[] };
let generation = 0;
let recordRequests = new Map<string, AbortController>();
let pageRequests = new Map<string, { from: string; ctl: AbortController }>();
// Advanced whenever the trail is replaced wholesale (also by setTrail, which keeps the generation).
let trailToken = 0;
let queue: Queue = { active: 0, pending: [] };

function bump() {
    generation += 1;
    for (const c of recordRequests.values()) c.abort();
    for (const r of pageRequests.values()) r.ctl.abort();
    trailToken += 1;
    recordRequests = new Map();
    pageRequests = new Map();
    queue = { active: 0, pending: [] };
}

/** Aborts the requests of nodes (and of clusters grown from nodes) that `keep` rejects. */
function abortRemoved(keep: (id: string) => boolean) {
    for (const [id, c] of recordRequests)
        if (!keep(id)) {
            c.abort();
            recordRequests.delete(id);
        }
    for (const [key, r] of pageRequests)
        if (!keep(r.from)) {
            r.ctl.abort();
            pageRequests.delete(key);
        }
}

const isAbort = (e: unknown) =>
    e instanceof DOMException && e.name === 'AbortError';

/** The server refused the table: no primary key, a binary key, or a view. */
const isNotExplorable = (e: unknown) =>
    e instanceof ApiError &&
    e.status === 422 &&
    dbErrorFrom(e, '').reason === 'no_primary_key';

/** Laravel rejected the request itself (a malformed key from a link), not the database. */
function isInvalidRequest(e: unknown): boolean {
    if (!(e instanceof ApiError) || e.status !== 422) return false;
    const errors = (e.body as { errors?: Record<string, unknown> } | null)
        ?.errors;
    return (
        typeof errors === 'object' &&
        errors !== null &&
        ('key' in errors || 'table' in errors)
    );
}

function runQueued(task: () => Promise<void>) {
    const q = queue;
    const pump = () => {
        while (q.active < CONCURRENCY && q.pending.length > 0) {
            const next = q.pending.shift()!;
            q.active += 1;
            next();
        }
    };
    q.pending.push(() => {
        void task()
            .catch(() => undefined)
            .finally(() => {
                q.active -= 1;
                pump();
            });
    });
    pump();
}

export const useRecords = create<RecordsState>()((set, get) => {
    const fresh = (gen: number) => gen === generation;
    const inTrail = (id: string) => get().trail.nodes.some((n) => n.id === id);

    const loadRecord = (id: string, direct = false) => {
        const { connectionId, trail } = get();
        const node = trail.nodes.find((n) => n.id === id);
        if (connectionId === null || !node) return;
        // One request per node at a time.
        if (recordRequests.has(id)) return;
        const gen = generation;
        const ctl = new AbortController();
        const signal = ctl.signal;
        recordRequests.set(id, ctl);
        const finish = () => {
            if (recordRequests.get(id) === ctl) recordRequests.delete(id);
        };
        const prior = get().records[id];
        set({
            records: {
                ...get().records,
                [id]: { status: 'loading', preview: prior?.preview },
            },
        });
        const task = async () => {
            if (!fresh(gen) || !inTrail(id)) {
                finish();
                return;
            }
            try {
                const payload = await recordsApi.show(
                    connectionId,
                    node.table,
                    node.key,
                    signal,
                );
                finish();
                if (!fresh(gen) || !inTrail(id)) return;
                set({
                    records: {
                        ...get().records,
                        [id]: {
                            status: 'ready',
                            payload,
                            preview: get().records[id]?.preview,
                        },
                    },
                });
            } catch (e) {
                finish();
                if (!fresh(gen) || !inTrail(id) || isAbort(e)) return;
                const preview = get().records[id]?.preview;
                if (e instanceof ApiError && e.status === 404) {
                    set({
                        records: {
                            ...get().records,
                            [id]: { status: 'missing', preview },
                        },
                    });
                } else if (
                    (isNotExplorable(e) || isInvalidRequest(e)) &&
                    id === get().trail.nodes[0]?.id
                ) {
                    // Only a root that can never load empties the trail; database errors
                    // (also 422) keep it, with Retry on the card.
                    set({
                        trail: emptyTrail(),
                        records: {},
                        systemEpoch: get().systemEpoch + 1,
                        notice: dbErrorFrom(e, 'Could not open the record.')
                            .message,
                        noticeTable: isNotExplorable(e) ? node.table : null,
                    });
                } else {
                    set({
                        records: {
                            ...get().records,
                            [id]: {
                                status: 'error',
                                preview,
                                error: dbErrorFrom(
                                    e,
                                    'Could not load the record.',
                                ).message,
                            },
                        },
                    });
                }
            }
        };
        if (direct) void task();
        else runQueued(task);
    };

    const fetchPage = (
        fromId: string,
        summary: RelationshipSummary,
        cursor: string | null,
    ) => {
        const { connectionId, trail } = get();
        const from = trail.nodes.find((n) => n.id === fromId);
        if (connectionId === null || !from) return;
        const key = clusterKey(fromId, summary.id, summary.direction);
        const gen = generation;
        const existing = get().clusters[key];
        // A page is in flight for this port: ignore repeated clicks.
        if (pageRequests.has(key)) return;
        const ctl = new AbortController();
        const signal = ctl.signal;
        const token = trailToken;
        pageRequests.set(key, { from: fromId, ctl });
        const finish = () => {
            if (pageRequests.get(key)?.ctl === ctl) pageRequests.delete(key);
        };
        if (existing)
            set({
                clusters: {
                    ...get().clusters,
                    [key]: { ...existing, loading: true },
                },
            });
        recordsApi
            .related(
                connectionId,
                from.table,
                from.key,
                {
                    rel: summary.id,
                    dir: summary.direction,
                    limit: PAGE,
                    cursor,
                },
                signal,
            )
            .then((page) => {
                finish();
                // The trail was replaced, or the source card was removed meanwhile.
                if (!fresh(gen) || token !== trailToken || !inTrail(fromId))
                    return;
                const state = get();
                const targets = page.rows.map((r) => ({
                    table: page.table,
                    key: r.key,
                }));
                const result = addRelated(
                    state.trail,
                    fromId,
                    summary.id,
                    summary.direction,
                    targets,
                );
                const records = { ...state.records };
                page.rows.forEach((r) => {
                    const id = nodeId(page.table, r.key);
                    if (records[id]) return;
                    records[id] = {
                        status: 'loading',
                        preview: {
                            columns: page.columns,
                            values: r.values,
                            primaryKey: page.primary_key,
                        },
                    };
                });
                for (const id of Object.keys(records))
                    if (!result.trail.nodes.some((n) => n.id === id))
                        delete records[id];

                const clusters = { ...state.clusters };
                // Rows refused by the node cap stay reachable: keep the cursor that fetches them again.
                if (page.next_cursor !== null || result.refused > 0) {
                    const edgeCount = result.trail.edges.filter(
                        (e) =>
                            e.from === fromId &&
                            e.rel === summary.id &&
                            e.dir === summary.direction,
                    ).length;
                    clusters[key] = {
                        from: fromId,
                        table: page.table,
                        summary,
                        remaining:
                            summary.count && !summary.count.capped
                                ? Math.max(0, summary.count.value - edgeCount)
                                : null,
                        cursor: result.refused > 0 ? cursor : page.next_cursor,
                        // A kept (earlier) cursor accounts for the edges that existed before this page.
                        edgeCount:
                            result.refused > 0
                                ? state.trail.edges.filter(
                                      (e) =>
                                          e.from === fromId &&
                                          e.rel === summary.id &&
                                          e.dir === summary.direction,
                                  ).length
                                : edgeCount,
                        loading: false,
                    };
                } else {
                    delete clusters[key];
                }
                // Opening a parent (belongs-to) moves the selection to it, in this same trail update.
                const parent =
                    summary.direction === 'out' && page.rows[0]
                        ? nodeId(page.table, page.rows[0].key)
                        : null;
                set({
                    trail:
                        parent &&
                        result.trail.nodes.some((n) => n.id === parent)
                            ? selectNode(result.trail, parent)
                            : result.trail,
                    records,
                    clusters,
                    ...(result.refused > 0
                        ? { notice: TRAIL_FULL_NOTICE, noticeTable: null }
                        : {}),
                });
                result.added.forEach((id) => loadRecord(id));
            })
            .catch((e) => {
                finish();
                if (
                    !fresh(gen) ||
                    token !== trailToken ||
                    !inTrail(fromId) ||
                    isAbort(e)
                )
                    return;
                const cluster = get().clusters[key];
                if (cluster)
                    set({
                        clusters: {
                            ...get().clusters,
                            [key]: { ...cluster, loading: false },
                        },
                    });
                set({
                    notice: dbErrorFrom(e, 'Could not load related records.')
                        .message,
                    noticeTable: isNotExplorable(e) ? summary.table : null,
                });
            });
    };

    return {
        ...initial(),
        setConnection: (id) => {
            if (get().connectionId === id) return;
            bump();
            set({
                ...initial(),
                connectionId: id,
                epoch: get().epoch + 1,
                systemEpoch: get().systemEpoch,
            });
        },
        open: (table, key) => {
            if (get().connectionId === null) return;
            bump();
            const trail = openRoot(table, key);
            set({
                trail,
                records: {},
                clusters: {},
                notice: null,
                noticeTable: null,
                epoch: get().epoch + 1,
            });
            loadRecord(trail.selected!, true);
        },
        expand: (fromId, summary) => {
            const key = clusterKey(fromId, summary.id, summary.direction);
            const existing = get().clusters[key];
            // An already expanded, partially loaded port continues instead of starting over.
            if (existing) fetchPage(fromId, summary, existing.cursor);
            else fetchPage(fromId, summary, null);
        },
        more: (key) => {
            const cluster = get().clusters[key];
            if (!cluster) return;
            fetchPage(cluster.from, cluster.summary, cluster.cursor);
        },
        select: (id) => {
            const { trail } = get();
            // Unchanged selection: same trail object, so no URL history entry.
            if (trail.selected === id) return;
            if (trail.nodes.some((n) => n.id === id))
                set({ trail: selectNode(trail, id) });
        },
        remove: (id) => {
            const { trail, records, clusters } = get();
            if (!trail.nodes.some((n) => n.id === id)) return;
            if (trail.nodes[0].id === id) {
                bump();
                set({
                    ...initial(),
                    systemEpoch: get().systemEpoch,
                    connectionId: get().connectionId,
                    epoch: get().epoch + 1,
                });
                return;
            }
            const edges = trail.edges.filter(
                (e) => e.from !== id && e.to !== id,
            );
            const reach = new Set([trail.nodes[0].id]);
            for (let grew = true; grew;) {
                grew = false;
                for (const e of edges)
                    if (reach.has(e.from) && !reach.has(e.to)) {
                        reach.add(e.to);
                        grew = true;
                    }
            }
            const nodes = trail.nodes.filter((n) => reach.has(n.id));
            const keep = (k: string) => reach.has(k);
            abortRemoved(keep);
            set({
                trail: {
                    nodes,
                    edges: edges.filter((e) => keep(e.from) && keep(e.to)),
                    selected:
                        trail.selected && reach.has(trail.selected)
                            ? trail.selected
                            : nodes[0].id,
                },
                records: Object.fromEntries(
                    Object.entries(records).filter(([k]) => keep(k)),
                ),
                clusters: Object.fromEntries(
                    Object.entries(clusters).filter(([, c]) => keep(c.from)),
                ),
            });
        },
        reload: (id) => loadRecord(id),
        setTrail: (trail) => {
            // Same generation: requests for nodes that stay keep running; only removed nodes are aborted.
            const ids = new Set(trail.nodes.map((n) => n.id));
            const state = get();
            abortRemoved((id) => ids.has(id));
            // A page requested for the old trail must not be applied to the new one.
            for (const r of pageRequests.values()) r.ctl.abort();
            pageRequests = new Map();
            trailToken += 1;
            const records = Object.fromEntries(
                Object.entries(state.records).filter(([id]) => ids.has(id)),
            );
            const clusters = Object.fromEntries(
                Object.entries(state.clusters)
                    .filter(
                        ([, c]) =>
                            ids.has(c.from) &&
                            trail.edges.some(
                                (e) =>
                                    e.from === c.from &&
                                    e.rel === c.summary.id &&
                                    e.dir === c.summary.direction,
                            ),
                    )
                    .map(([key, c]) => {
                        const count = trail.edges.filter(
                            (e) =>
                                e.from === c.from &&
                                e.rel === c.summary.id &&
                                e.dir === c.summary.direction,
                        ).length;
                        const total = c.summary.count;
                        return [
                            key,
                            {
                                ...c,
                                loading: false,
                                // The cursor only fits a trail with as many edges as when it was taken.
                                cursor: count === c.edgeCount ? c.cursor : null,
                                edgeCount: count,
                                remaining:
                                    total && !total.capped
                                        ? Math.max(0, total.value - count)
                                        : null,
                            },
                        ];
                    }),
            );
            set({
                trail,
                records,
                clusters,
                notice: null,
                noticeTable: null,
                epoch: state.epoch + 1,
            });
            trail.nodes.forEach((n, i) => {
                const status = records[n.id]?.status;
                if (status === 'ready' || status === 'missing') return;
                loadRecord(n.id, i === 0);
            });
        },
        dismissNotice: () => set({ notice: null, noticeTable: null }),
        reset: () => {
            bump();
            set({
                ...initial(),
                epoch: get().epoch + 1,
                systemEpoch: get().systemEpoch,
            });
        },
    };
});
