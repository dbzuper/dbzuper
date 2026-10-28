import { safeStorage } from './safe-storage';
import type { WorkspaceRef } from '@/types/connection';

export type GridLayout = { widths: Record<string, number>; hidden: string[] };
export type SidebarPrefs = { width: number; collapsed: boolean };

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 240;

const GRID_KEY = 'dbzuper.grid-layout';
const SIDEBAR_KEY = 'dbzuper.sidebar';
/** Layouts are kept for at most this many tables; the oldest are forgotten first. */
const MAX_LAYOUTS = 500;

function readJson(key: string): unknown {
    const raw = safeStorage.getItem(key);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

const layoutKey = (connectionId: WorkspaceRef, table: string) =>
    `${connectionId}:${table}`;

export function readGridLayout(
    connectionId: WorkspaceRef,
    table: string,
): GridLayout {
    const all = readJson(GRID_KEY);
    const found =
        all && typeof all === 'object'
            ? (all as Record<string, unknown>)[layoutKey(connectionId, table)]
            : null;
    const value = found as Partial<GridLayout> | null;
    const widths: Record<string, number> = {};
    if (value && value.widths && typeof value.widths === 'object')
        for (const [k, w] of Object.entries(value.widths))
            if (typeof w === 'number' && Number.isFinite(w) && w > 0)
                widths[k] = w;
    const hidden = Array.isArray(value?.hidden)
        ? value.hidden.filter((h): h is string => typeof h === 'string')
        : [];
    return { widths, hidden };
}

export function writeGridLayout(
    connectionId: WorkspaceRef,
    table: string,
    layout: GridLayout,
): void {
    const all = readJson(GRID_KEY);
    const map: Record<string, GridLayout> =
        all && typeof all === 'object'
            ? { ...(all as Record<string, GridLayout>) }
            : {};
    const key = layoutKey(connectionId, table);
    delete map[key];
    map[key] = layout;
    const keys = Object.keys(map);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_LAYOUTS)))
        delete map[old];
    safeStorage.setItem(GRID_KEY, JSON.stringify(map));
}

export function readSidebarPrefs(): SidebarPrefs {
    const v = readJson(SIDEBAR_KEY) as Partial<SidebarPrefs> | null;
    const width =
        typeof v?.width === 'number' && Number.isFinite(v.width)
            ? v.width
            : SIDEBAR_DEFAULT;
    return {
        width: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)),
        collapsed: v?.collapsed === true,
    };
}

export function writeSidebarPrefs(p: SidebarPrefs): void {
    safeStorage.setItem(
        SIDEBAR_KEY,
        JSON.stringify({
            width: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, p.width)),
            collapsed: p.collapsed,
        }),
    );
}

export type GroupPrefs = { open: string[] };

const GROUPS_KEY = 'dbzuper.sidebar-groups';
const GROUPING_KEY = 'dbzuper.sidebar-grouping';

export function readGroupPrefs(connectionId: WorkspaceRef): GroupPrefs {
    const all = readJson(GROUPS_KEY);
    const found =
        all && typeof all === 'object'
            ? (all as Record<string, unknown>)[String(connectionId)]
            : null;
    const open = (found as Partial<GroupPrefs> | null)?.open;
    return {
        open: Array.isArray(open)
            ? open.filter((p): p is string => typeof p === 'string')
            : [],
    };
}

export function writeGroupPrefs(
    connectionId: WorkspaceRef,
    p: GroupPrefs,
): void {
    const all = readJson(GROUPS_KEY);
    const map: Record<string, GroupPrefs> =
        all && typeof all === 'object'
            ? { ...(all as Record<string, GroupPrefs>) }
            : {};
    map[String(connectionId)] = { open: p.open };
    safeStorage.setItem(GROUPS_KEY, JSON.stringify(map));
}

export function readGroupingEnabled(): boolean {
    return readJson(GROUPING_KEY) !== false;
}

export function writeGroupingEnabled(on: boolean): void {
    safeStorage.setItem(GROUPING_KEY, JSON.stringify(on));
}
