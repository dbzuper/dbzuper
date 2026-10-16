export type UniverseHandle = {
    flyTo(table: string): void;
    fitNodes(tables: string[]): void;
    fitAll(): void;
    relayout(): void;
};

let current: UniverseHandle | null = null;
// A flyTo asked for before any canvas registered (the canvas mounts lazily, the first time the
// Universe tab is shown); the canvas that registers next applies it.
let pendingFlyTo: string | null = null;
// Likewise a fit/re-layout asked for before the canvas mounted.
let pendingView: 'fitAll' | 'relayout' | null = null;

/** Called by the canvas once its renderer has drawn the graph (and with null on teardown). */
export function registerUniverse(handle: UniverseHandle | null): void {
    current = handle;
    if (handle && pendingView !== null) {
        const op = pendingView;
        pendingView = null;
        handle[op]();
    }
    if (handle && pendingFlyTo !== null) {
        const table = pendingFlyTo;
        pendingFlyTo = null;
        handle.flyTo(table);
    }
}

/** Drops a pending flyTo (the connection changed, so its table may not exist). */
export function clearPendingFlyTo(): void {
    pendingFlyTo = null;
    pendingView = null;
}

export const universe = {
    flyTo: (table: string) => {
        if (current) {
            pendingFlyTo = null;
            current.flyTo(table);
        } else pendingFlyTo = table;
    },
    fitNodes: (tables: string[]) => current?.fitNodes(tables),
    fitAll: () => {
        if (current) current.fitAll();
        else pendingView = 'fitAll';
    },
    relayout: () => {
        if (current) current.relayout();
        else pendingView = 'relayout';
    },
    isMounted: () => current !== null,
};
