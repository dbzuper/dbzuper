export type UniverseHandle = {
    flyTo(table: string): void;
    fitNodes(tables: string[]): void;
    fitAll(): void;
    relayout(): void;
};

let current: UniverseHandle | null = null;

export function registerUniverse(handle: UniverseHandle | null): void {
    current = handle;
}

export const universe = {
    flyTo: (table: string) => current?.flyTo(table),
    fitNodes: (tables: string[]) => current?.fitNodes(tables),
    fitAll: () => current?.fitAll(),
    relayout: () => current?.relayout(),
    isMounted: () => current !== null,
};
