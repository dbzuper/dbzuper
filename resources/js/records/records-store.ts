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
    /** Bumped whenever the trail is replaced (open, setTrail, reset), so views can refit and drop drag state. */
    epoch: number;
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
    epoch: 0,
});

// Every async action captures the current "generation" and drops its result when the trail
// has been replaced in the meantime. The record queue lives with the generation too.
type Queue = { active: number; pending: (() => void)[] };
let inflight = new Set<string>();
let generation = 0;
let controller = new AbortController();
let queue: Queue = { active: 0, pending: [] };

function bump() {
    generation += 1;
    controller.abort();
    controller = new AbortController();
    queue = { active: 0, pending: [] };
    inflight = new Set();
}

const isAbort = (e: unknown) =>
    e instanceof DOMException && e.name === 'AbortError';

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
        void task().finally(() => {
            q.active -= 1;
            pump();
        });
    });
    pump();
}

export const useRecords = create<RecordsState>()((set, get) => {
    const current = () => ({ gen: generation, signal: controller.signal });
    const fresh = (gen: number) => gen === generation;

    const loadRecord = (id: string, direct = false) => {
        const { connectionId, trail } = get();
        const node = trail.nodes.find((n) => n.id === id);
        if (connectionId === null || !node) return;
        const { gen, signal } = current();
        const prior = get().records[id];
        set({
            records: {
                ...get().records,
                [id]: { status: 'loading', preview: prior?.preview },
            },
        });
        const task = async () => {
            if (!fresh(gen)) return;
            try {
                const payload = await recordsApi.show(
                    connectionId,
                    node.table,
                    node.key,
                    signal,
                );
                if (!fresh(gen)) return;
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
                if (!fresh(gen) || isAbort(e)) return;
                const preview = get().records[id]?.preview;
                if (e instanceof ApiError && e.status === 404) {
                    set({
                        records: {
                            ...get().records,
                            [id]: { status: 'missing', preview },
                        },
                    });
                } else if (
                    e instanceof ApiError &&
                    e.status === 422 &&
                    id === get().trail.nodes[0]?.id
                ) {
                    set({
                        trail: emptyTrail(),
                        records: {},
                        notice: dbErrorFrom(e, 'Could not open the record.')
                            .message,
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
        const { gen, signal } = current();
        const existing = get().clusters[key];
        // A page is in flight for this port: ignore repeated clicks.
        if (inflight.has(key)) return;
        inflight.add(key);
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
                if (!fresh(gen)) return;
                inflight.delete(key);
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
                if (page.next_cursor !== null) {
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
                        cursor: page.next_cursor,
                        loading: false,
                    };
                } else {
                    delete clusters[key];
                }
                set({
                    trail: result.trail,
                    records,
                    clusters,
                    notice:
                        result.refused > 0 ? TRAIL_FULL_NOTICE : state.notice,
                });
                result.added.forEach((id) => loadRecord(id));
            })
            .catch((e) => {
                if (!fresh(gen)) return;
                inflight.delete(key);
                if (isAbort(e)) return;
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
                });
            });
    };

    return {
        ...initial(),
        setConnection: (id) => {
            if (get().connectionId === id) return;
            bump();
            set({ ...initial(), connectionId: id, epoch: get().epoch + 1 });
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
            bump();
            set({
                trail,
                records: {},
                clusters: {},
                notice: null,
                epoch: get().epoch + 1,
            });
            trail.nodes.forEach((n, i) => loadRecord(n.id, i === 0));
        },
        dismissNotice: () => set({ notice: null }),
        reset: () => {
            bump();
            set({ ...initial(), epoch: get().epoch + 1 });
        },
    };
});
