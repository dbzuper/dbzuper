import type { LayoutPositionEntry } from '@/types/schema';

/**
 * Request bodies stay under this many bytes. Browsers cap in-flight `keepalive` fetches at 64 KB, so
 * a save that must outlive the page is split into chunks below it.
 */
export const MAX_CHUNK_BYTES = 60_000;

const encoder = new TextEncoder();
// The envelope around the entries: `{"merge":false,"positions":[` plus `]}` and a comma per entry.
const ENVELOPE_BYTES = encoder.encode('{"merge":false,"positions":[]}').length;

export function chunkEntries(
    entries: LayoutPositionEntry[],
    maxBytes = MAX_CHUNK_BYTES,
): LayoutPositionEntry[][] {
    const chunks: LayoutPositionEntry[][] = [];
    let current: LayoutPositionEntry[] = [];
    let size = ENVELOPE_BYTES;
    for (const entry of entries) {
        const entrySize = encoder.encode(JSON.stringify(entry)).length + 1;
        if (current.length > 0 && size + entrySize > maxBytes) {
            chunks.push(current);
            current = [];
            size = ENVELOPE_BYTES;
        }
        current.push(entry);
        size += entrySize;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
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

export type LayoutSaver = {
    /** The layout version a save is made under; bumped by every full save and re-layout. */
    generation: () => number;
    /** Starts a new generation, so saves made under the previous one are dropped. */
    bump: () => number;
    /** Records what the server already holds. */
    baseline: (entries: LayoutPositionEntry[]) => void;
    /** Replaces the stored layout (a computed or re-laid-out one). */
    saveFull: (entries: LayoutPositionEntry[]) => void;
    /** Saves only what changed since the last save, merged and chunked; a stale generation is dropped. */
    saveChanged: (entries: LayoutPositionEntry[], generation: number) => void;
};

export function createLayoutSaver(
    connectionId: number,
    send: SendLayout,
    onError: () => void,
): LayoutSaver {
    let generation = 0;
    let last = new Map<string, LayoutPositionEntry>();
    let failed = false;
    const fail = () => {
        if (failed) return;
        failed = true;
        onError();
    };
    const remember = (entries: LayoutPositionEntry[]) => {
        for (const e of entries) last.set(e.table, e);
    };

    return {
        generation: () => generation,
        bump: () => ++generation,
        baseline: (entries) => {
            last = new Map(entries.map((e) => [e.table, e]));
        },
        saveFull: (entries) => {
            generation++;
            last = new Map(entries.map((e) => [e.table, e]));
            failed = false;
            send(connectionId, entries, {
                keepalive: false,
                merge: false,
            }).catch(fail);
        },
        saveChanged: (entries, gen) => {
            if (gen !== generation) return;
            const changed = changedEntries(last, entries);
            if (changed.length === 0) return;
            remember(changed);
            failed = false;
            for (const chunk of chunkEntries(changed))
                send(connectionId, chunk, {
                    keepalive: true,
                    merge: true,
                }).catch(() => {
                    // Forget it, so the next save sends these positions again.
                    for (const e of chunk) last.delete(e.table);
                    fail();
                });
        },
    };
}
