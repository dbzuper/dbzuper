import type { LayoutPositionEntry } from '@/types/schema';

/**
 * Browsers reject `keepalive` bodies beyond 64 KiB in flight (summed over requests). The unload flush
 * stays under this running total; what does not fit is kept in localStorage for the next load.
 */
export const MAX_KEEPALIVE_BYTES = 60_000;

const encoder = new TextEncoder();
// The envelope around the entries: `{"merge":false,"positions":[]}`; each entry also adds a comma.
const ENVELOPE_BYTES = encoder.encode('{"merge":false,"positions":[]}').length;

/** The longest prefix of `entries` whose request body stays under `maxBytes`, and the rest. */
export function splitByBytes(
    entries: LayoutPositionEntry[],
    maxBytes = MAX_KEEPALIVE_BYTES,
): { fit: LayoutPositionEntry[]; rest: LayoutPositionEntry[] } {
    let size = ENVELOPE_BYTES;
    let count = 0;
    for (const entry of entries) {
        size += encoder.encode(JSON.stringify(entry)).length + 1;
        if (size > maxBytes) break;
        count++;
    }
    return { fit: entries.slice(0, count), rest: entries.slice(count) };
}

/** Entries that are new, moved, or changed pin state compared with what was last saved. */
export function changedEntries(
    last: Map<string, LayoutPositionEntry>,
    next: LayoutPositionEntry[],
): LayoutPositionEntry[] {
    return next.filter((e) => {
        const before = last.get(e.table);
        return (
            !before ||
            before.x !== e.x ||
            before.y !== e.y ||
            before.pinned !== e.pinned
        );
    });
}

export type SendLayout = (
    connectionId: number,
    positions: LayoutPositionEntry[],
    opts: { keepalive: boolean; merge: boolean },
) => Promise<unknown>;

export type SaveProblem = 'failed' | 'too_large';

export type LayoutSaver = {
    /** The layout version a save is made under; bumped by every full save and re-layout. */
    generation: () => number;
    /** Starts a new generation, so saves made under the previous one are dropped. */
    bump: () => number;
    /** Records what the server already holds. */
    baseline: (entries: LayoutPositionEntry[]) => void;
    /** Replaces the stored layout (a computed or re-laid-out one). */
    saveFull: (entries: LayoutPositionEntry[]) => void;
    /** Queues the positions changed since the last save as a merge; a stale generation is dropped. */
    saveChanged: (entries: LayoutPositionEntry[], generation: number) => void;
    /**
     * Hide/unload flush: sends everything not yet saved with keepalive, within the keepalive budget,
     * and keeps what does not fit in localStorage.
     */
    unload: () => void;
    /** Sends entries kept by an earlier unload as a merge; resolves when every save has finished. */
    replayStored: () => Promise<void>;
};

const storageKey = (connectionId: number) =>
    `dbsuperb.layout-pending.${connectionId}`;

function readStored(connectionId: number): LayoutPositionEntry[] {
    try {
        const raw = localStorage.getItem(storageKey(connectionId));
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as LayoutPositionEntry[]) : [];
    } catch {
        return [];
    }
}

function writeStored(connectionId: number, entries: LayoutPositionEntry[]) {
    try {
        if (entries.length === 0)
            localStorage.removeItem(storageKey(connectionId));
        else
            localStorage.setItem(
                storageKey(connectionId),
                JSON.stringify(entries),
            );
    } catch {
        /* storage unavailable or full: the entries are lost, as before */
    }
}

const statusOf = (e: unknown) =>
    typeof e === 'object' && e !== null && 'status' in e
        ? (e as { status: unknown }).status
        : null;

/**
 * One saver per connection. All saves go through a single queue with one request in flight: a merge
 * waits for a pending full save, and queued merges coalesce. Normal saves are plain fetches; only the
 * unload flush uses keepalive.
 */
export function createLayoutSaver(
    connectionId: number,
    send: SendLayout,
    onProblem: (problem: SaveProblem) => void,
): LayoutSaver {
    let generation = 0;
    let last = new Map<string, LayoutPositionEntry>();
    const queue = new Map<string, LayoutPositionEntry>();
    let pendingFull: LayoutPositionEntry[] | null = null;
    let inFlight: LayoutPositionEntry[] = [];
    let busy = false;
    let idleWaiters: (() => void)[] = [];
    let reported = false;

    const report = (problem: SaveProblem) => {
        if (reported) return;
        reported = true;
        onProblem(problem);
    };

    const forgetStored = (entries: LayoutPositionEntry[]) => {
        const stored = readStored(connectionId);
        if (stored.length === 0) return;
        const done = new Set(entries.map((e) => e.table));
        writeStored(
            connectionId,
            stored.filter((e) => !done.has(e.table)),
        );
    };

    const finish = () => {
        busy = false;
        inFlight = [];
        if (pendingFull || queue.size > 0) {
            pump();
            return;
        }
        const waiters = idleWaiters;
        idleWaiters = [];
        for (const resolve of waiters) resolve();
    };

    function pump() {
        if (busy) return;
        if (pendingFull) {
            const entries = pendingFull;
            pendingFull = null;
            busy = true;
            inFlight = entries;
            send(connectionId, entries, { keepalive: false, merge: false })
                .then(() => forgetStored(entries))
                .catch(() => {
                    // The server may hold an older layout: clear what we remember, so the next
                    // save sends every position as a merge.
                    last = new Map();
                    report('failed');
                })
                .finally(finish);
            return;
        }
        if (queue.size === 0) return;
        const entries = [...queue.values()];
        queue.clear();
        busy = true;
        inFlight = entries;
        send(connectionId, entries, { keepalive: false, merge: true })
            .then(() => forgetStored(entries))
            .catch((e: unknown) => {
                if (statusOf(e) === 422) {
                    // Over the entry cap: resending cannot help, so stop trying these.
                    forgetStored(entries);
                    report('too_large');
                    return;
                }
                // Forget them, so the next save sends these positions again.
                for (const entry of entries) last.delete(entry.table);
                report('failed');
            })
            .finally(finish);
    }

    return {
        generation: () => generation,
        bump: () => ++generation,
        baseline: (entries) => {
            last = new Map(entries.map((e) => [e.table, e]));
        },
        saveFull: (entries) => {
            generation++;
            queue.clear();
            reported = false;
            last = new Map(entries.map((e) => [e.table, e]));
            pendingFull = entries;
            pump();
        },
        saveChanged: (entries, gen) => {
            if (gen !== generation) return;
            const changed = changedEntries(last, entries);
            if (changed.length === 0) return;
            reported = false;
            for (const entry of changed) {
                last.set(entry.table, entry);
                queue.set(entry.table, entry);
            }
            // After the current task, so a hide/unload flush can claim the queue first.
            queueMicrotask(pump);
        },
        unload: () => {
            const all = new Map<string, LayoutPositionEntry>();
            for (const e of [
                ...inFlight,
                ...(pendingFull ?? []),
                ...queue.values(),
            ])
                all.set(e.table, e);
            pendingFull = null;
            queue.clear();
            if (all.size === 0) return;
            const { fit, rest } = splitByBytes([...all.values()]);
            if (fit.length > 0)
                send(connectionId, fit, { keepalive: true, merge: true })
                    .then(() => forgetStored(fit))
                    .catch(() => {
                        for (const entry of fit) last.delete(entry.table);
                    });
            if (rest.length > 0) {
                const stored = new Map(
                    readStored(connectionId).map((e) => [e.table, e]),
                );
                for (const e of rest) stored.set(e.table, e);
                writeStored(connectionId, [...stored.values()]);
            }
        },
        replayStored: () => {
            const stored = readStored(connectionId);
            for (const e of stored) {
                queue.set(e.table, e);
                last.set(e.table, e);
            }
            if (stored.length > 0) pump();
            if (!busy && queue.size === 0 && !pendingFull)
                return Promise.resolve();
            return new Promise<void>((resolve) => idleWaiters.push(resolve));
        },
    };
}
