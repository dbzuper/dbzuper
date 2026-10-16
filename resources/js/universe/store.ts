import { create } from 'zustand';

/** The SQL dock's height limits, in px. */
export const DOCK_MIN_HEIGHT = 160;
export const DOCK_MAX_HEIGHT = 900;

export type ZoomLevel = 'galaxy' | 'system' | 'closeup';
export type InspectorTab =
    | 'columns'
    | 'relationships'
    | 'indexes'
    | 'data'
    | 'ddl';

export type DataFilterPair = { column: string; value: string };
export type DataFilter = { table: string; filters: DataFilterPair[] };

type State = {
    selected: string | null;
    hovered: string | null;
    focus: { table: string; depth: 1 | 2 } | null;
    showInferred: boolean;
    view: 'universe' | 'list' | 'records';
    zoomLevel: ZoomLevel;
    inspectorTab: InspectorTab;
    pathFrom: string | null;
    pathTo: string | null;
    path: string[] | null;
    paletteOpen: boolean;
    dockOpen: boolean;
    historyOpen: boolean;
    dockHeight: number;
    dataFilter: DataFilter | null;
    /** Bumped after every SQL run, so views of the history can reload. */
    runCount: number;
};

type Actions = {
    select: (table: string | null, tab?: InspectorTab) => void;
    hover: (table: string | null) => void;
    setFocus: (table: string | null, depth?: 1 | 2) => void;
    toggleInferred: () => void;
    setView: (view: State['view']) => void;
    setZoomLevel: (level: ZoomLevel) => void;
    setInspectorTab: (tab: InspectorTab) => void;
    startPath: (from: string) => void;
    completePath: (to: string, path: string[] | null) => void;
    clearPath: () => void;
    setPaletteOpen: (open: boolean) => void;
    setDockOpen: (open: boolean) => void;
    setHistoryOpen: (open: boolean) => void;
    setDockHeight: (px: number) => void;
    openDataFilter: (table: string, filters: DataFilterPair[]) => void;
    clearDataFilter: () => void;
    bumpRuns: () => void;
    reset: () => void;
};

export type WorkspaceState = State & Actions;

const initial: State = {
    selected: null,
    hovered: null,
    focus: null,
    showInferred: true,
    view: 'universe',
    zoomLevel: 'system',
    inspectorTab: 'columns',
    pathFrom: null,
    pathTo: null,
    path: null,
    paletteOpen: false,
    dockOpen: false,
    historyOpen: false,
    dockHeight: 320,
    dataFilter: null,
    runCount: 0,
};

export const useWorkspace = create<WorkspaceState>()((set, get) => ({
    ...initial,
    select: (table, tab) =>
        set(tab ? { selected: table, inspectorTab: tab } : { selected: table }),
    hover: (table) => {
        if (get().hovered !== table) set({ hovered: table });
    },
    setFocus: (table, depth = 1) =>
        set({ focus: table ? { table, depth } : null }),
    toggleInferred: () => set({ showInferred: !get().showInferred }),
    setView: (view) => set({ view }),
    setZoomLevel: (zoomLevel) => {
        if (get().zoomLevel !== zoomLevel) set({ zoomLevel });
    },
    setInspectorTab: (inspectorTab) => set({ inspectorTab }),
    startPath: (from) => set({ pathFrom: from, pathTo: null, path: null }),
    completePath: (to, path) => set({ pathTo: to, path: path ?? [] }),
    clearPath: () => set({ pathFrom: null, pathTo: null, path: null }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setDockOpen: (dockOpen) => set({ dockOpen }),
    setHistoryOpen: (historyOpen) => set({ historyOpen }),
    setDockHeight: (px) =>
        set({
            dockHeight: Math.max(
                DOCK_MIN_HEIGHT,
                Math.min(px, DOCK_MAX_HEIGHT),
            ),
        }),
    openDataFilter: (table, filters) =>
        set({
            selected: table,
            inspectorTab: 'data',
            historyOpen: false,
            dataFilter: { table, filters },
        }),
    clearDataFilter: () => set({ dataFilter: null }),
    bumpRuns: () => set({ runCount: get().runCount + 1 }),
    reset: () => set({ ...initial }),
}));
