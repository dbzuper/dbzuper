/**
 * Open editors (the grid's inline cell editor; the row drawer's fields) register here while they hold a draft that
 * isn't staged yet. Review & commit flushes them first, so what it previews is everything the user typed.
 */
const flushers = new Set<() => void>();

/** Registers a flush (commit the draft, or close the editor); returns the unregister. */
export function registerEditFlush(flush: () => void): () => void {
    flushers.add(flush);
    return () => {
        flushers.delete(flush);
    };
}

/** Stages every open editor's draft now. */
export function flushOpenEdits(): void {
    // A flush closes its editor, which unregisters it: deleting while iterating a Set is safe.
    for (const flush of flushers) flush();
}
