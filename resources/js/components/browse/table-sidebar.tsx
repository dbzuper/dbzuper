import { useVirtualizer } from '@tanstack/react-virtual';
import {
    ChevronDown,
    ChevronRight,
    Eye,
    Search,
    Star,
    Table2,
    X,
} from 'lucide-react';
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
} from 'react';
import { useBrowse } from '@/browse/browse-store';
import { SIDEBAR_MAX, SIDEBAR_MIN } from '@/browse/local-prefs';
import { usePins } from '@/browse/pins-store';
import { useSidebarPrefs } from '@/browse/sidebar-prefs';
import { cn } from '@/lib/utils';
import { formatRowCount } from '@/lib/format';
import type { Pin } from '@/lib/pins-api';
import { searchSchema } from '@/universe/search';
import type { SchemaSnapshot, TableSchema } from '@/types/schema';
import { TableContextMenu, type TableActions } from './table-context-menu';

export const SIDEBAR_SEARCH_ID = 'table-sidebar-search';
const ROW_HEIGHT = 28;
const TYPE_AHEAD_MS = 500;
const PIN_DRAG_TYPE = 'text/x-dbsuperb-pin';

const NO_PINS: Pin[] = [];
const NO_RECENTS: string[] = [];

type Section = 'pinned' | 'recent' | 'all';
type Item = { key: string; section: Section; table: string };
const itemKey = (section: Section, table: string) => `${section}:${table}`;

type RowProps = {
    connectionId: number;
    table: TableSchema;
    section: Section;
    active: boolean;
    pinned: boolean;
    tabbable: boolean;
    actions: TableActions;
    style?: CSSProperties;
    onDragStart?: (table: string) => void;
    onDropOn?: (table: string) => void;
};

function SidebarRow({
    connectionId,
    table,
    section,
    active,
    pinned,
    tabbable,
    actions,
    style,
    onDragStart,
    onDropOn,
}: RowProps) {
    const name = table.name;
    const open = (event: MouseEvent) =>
        actions.open(
            name,
            event.ctrlKey || event.metaKey ? 'permanent' : 'preview',
        );
    const Icon = table.kind === 'view' ? Eye : Table2;

    return (
        <TableContextMenu
            connectionId={connectionId}
            table={name}
            actions={actions}
        >
            <div
                role="none"
                style={style}
                className="group/row relative flex h-7 items-center"
                draggable={section === 'pinned'}
                onDragStart={(e) => {
                    if (section !== 'pinned') return;
                    e.dataTransfer.setData(PIN_DRAG_TYPE, name);
                    e.dataTransfer.effectAllowed = 'move';
                    onDragStart?.(name);
                }}
                onDragOver={(e) => {
                    if (section === 'pinned') e.preventDefault();
                }}
                onDrop={(e) => {
                    if (section !== 'pinned') return;
                    e.preventDefault();
                    onDropOn?.(name);
                }}
            >
                <div
                    role="treeitem"
                    aria-selected={active}
                    aria-current={active ? 'true' : undefined}
                    aria-label={name}
                    data-table={name}
                    data-key={itemKey(section, name)}
                    tabIndex={tabbable ? 0 : -1}
                    title={name}
                    onClick={open}
                    onDoubleClick={() => actions.open(name, 'permanent')}
                    onAuxClick={(e) => {
                        if (e.button !== 1) return;
                        e.preventDefault();
                        actions.open(name, 'background');
                    }}
                    onMouseDown={(e) => {
                        if (e.button === 1) e.preventDefault();
                    }}
                    className={cn(
                        'flex h-7 min-w-0 flex-1 cursor-default items-center gap-2 rounded-sm pr-7 pl-2 text-sm outline-none select-none',
                        'hover:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring',
                        active && 'bg-accent text-accent-foreground',
                    )}
                >
                    <Icon
                        role="img"
                        aria-label={table.kind === 'view' ? 'View' : 'Table'}
                        className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatRowCount(table.row_count)}
                    </span>
                </div>
                <button
                    type="button"
                    tabIndex={-1}
                    aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
                    onClick={() =>
                        void usePins.getState().toggle(connectionId, name)
                    }
                    className={cn(
                        'absolute right-1 flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring',
                        pinned
                            ? 'opacity-100'
                            : 'opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100',
                    )}
                >
                    <Star
                        className={cn('size-3.5', pinned && 'fill-current')}
                    />
                </button>
            </div>
        </TableContextMenu>
    );
}

function SectionHeader({
    label,
    open,
    onToggle,
}: {
    label: string;
    open: boolean;
    onToggle: () => void;
}) {
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
        <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex h-7 w-full shrink-0 items-center gap-1 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
        >
            <Chevron className="size-3.5" />
            {label}
        </button>
    );
}

export function TableSidebar({
    connectionId,
    snapshot,
    actions,
}: {
    connectionId: number;
    snapshot: SchemaSnapshot;
    actions: TableActions;
}) {
    const [query, setQuery] = useState('');
    const [openSections, setOpenSections] = useState<Record<Section, boolean>>({
        pinned: true,
        recent: true,
        all: true,
    });
    const [focusKey, setFocusKey] = useState<string | null>(null);
    const [dragWidth, setDragWidth] = useState<number | null>(null);
    const width = useSidebarPrefs((s) => s.width);
    const collapsed = useSidebarPrefs((s) => s.collapsed);
    const pins = usePins((s) => s.byConnection[connectionId] ?? NO_PINS);
    const recents = useBrowse(
        (s) => s.byConnection[connectionId]?.recents ?? NO_RECENTS,
    );
    const activeTable = useBrowse((s) => {
        const c = s.byConnection[connectionId];
        const tab = c?.tabs.find((t) => t.id === c.activeId);
        return tab?.kind === 'table' ? tab.table : null;
    });
    const scrollRef = useRef<HTMLDivElement>(null);
    const pendingFocus = useRef<string | null>(null);
    const typed = useRef<{ text: string; at: number }>({ text: '', at: 0 });
    const dragged = useRef<string | null>(null);

    useEffect(() => {
        void usePins.getState().load(connectionId);
    }, [connectionId]);

    const byName = useMemo(
        () => new Map(snapshot.tables.map((t) => [t.name, t])),
        [snapshot],
    );
    const order = useMemo(
        () => new Map(snapshot.tables.map((t, i) => [t.name, i])),
        [snapshot],
    );
    const searching = query.trim() !== '';
    const matches = useMemo(
        () =>
            searching
                ? // Ranked by match score; ties keep the snapshot's own order.
                  searchSchema(snapshot, query, snapshot.tables.length)
                      .tables.filter((h) => h.kind === 'table')
                      .map((h, i) => ({ h, i, at: order.get(h.table) ?? i }))
                      .sort((a, b) => b.h.score - a.h.score || a.at - b.at)
                      .map(({ h }) => h.table)
                : null,
        [snapshot, query, searching, order],
    );

    const allNames = useMemo(
        () => matches ?? snapshot.tables.map((t) => t.name),
        [matches, snapshot],
    );
    const pinnedTables = useMemo(() => pins.map((p) => p.table), [pins]);
    const recentTables = useMemo(
        () => recents.filter((t) => byName.has(t)),
        [recents, byName],
    );
    const pinnedSet = useMemo(() => new Set(pinnedTables), [pinnedTables]);

    const showPinned = !searching && pins.length > 0;
    const showRecent = !searching && recentTables.length > 0;

    const items = useMemo<Item[]>(() => {
        const out: Item[] = [];
        const add = (section: Section, tables: string[]) =>
            tables.forEach((table) =>
                out.push({ key: itemKey(section, table), section, table }),
            );
        if (showPinned && openSections.pinned)
            add(
                'pinned',
                pinnedTables.filter((t) => byName.has(t)),
            );
        if (showRecent && openSections.recent) add('recent', recentTables);
        if (openSections.all) add('all', allNames);
        return out;
    }, [
        showPinned,
        showRecent,
        openSections,
        pinnedTables,
        recentTables,
        allNames,
        byName,
    ]);

    const virtualizer = useVirtualizer({
        count: openSections.all ? allNames.length : 0,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 12,
    });

    const tabbableKey =
        focusKey && items.some((i) => i.key === focusKey)
            ? focusKey
            : (items[0]?.key ?? null);

    // Move DOM focus once the target row exists (virtualized rows render lazily).
    useEffect(() => {
        const key = pendingFocus.current;
        if (!key) return;
        const el = document.querySelector<HTMLElement>(
            `[data-sidebar-tree] [data-key="${CSS.escape(key)}"]`,
        );
        if (el) {
            pendingFocus.current = null;
            el.focus();
        }
    });

    const moveTo = (index: number) => {
        const item = items[index];
        if (!item) return;
        pendingFocus.current = item.key;
        setFocusKey(item.key);
        if (item.section === 'all')
            virtualizer.scrollToIndex(allNames.indexOf(item.table));
        const el = document.querySelector<HTMLElement>(
            `[data-sidebar-tree] [data-key="${CSS.escape(item.key)}"]`,
        );
        if (el) {
            pendingFocus.current = null;
            el.focus();
        }
    };

    const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        const key = target.dataset.key;
        if (!key || target.getAttribute('role') !== 'treeitem') return;
        const index = items.findIndex((i) => i.key === key);
        if (index < 0) return;
        const item = items[index];

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                return moveTo(Math.min(items.length - 1, index + 1));
            case 'ArrowUp':
                event.preventDefault();
                return moveTo(Math.max(0, index - 1));
            case 'Home':
                event.preventDefault();
                return moveTo(0);
            case 'End':
                event.preventDefault();
                return moveTo(items.length - 1);
            case 'Enter':
                event.preventDefault();
                return actions.open(item.table, 'permanent');
            case ' ':
                event.preventDefault();
                return actions.open(item.table, 'preview');
        }

        if (
            event.key.length !== 1 ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
        )
            return;
        const now = Date.now();
        const buffer =
            now - typed.current.at > TYPE_AHEAD_MS
                ? event.key.toLowerCase()
                : typed.current.text + event.key.toLowerCase();
        typed.current = { text: buffer, at: now };
        // A single new character moves on to the next match; a longer prefix may stay put.
        const start = buffer.length === 1 ? index + 1 : index;
        for (let step = 0; step < items.length; step++) {
            const at = (start + step) % items.length;
            if (items[at].table.toLowerCase().startsWith(buffer))
                return moveTo(at);
        }
    };

    const toggleSection = (section: Section) =>
        setOpenSections((s) => ({ ...s, [section]: !s[section] }));

    const dropPin = (target: string) => {
        const from = dragged.current;
        dragged.current = null;
        if (!from || from === target) return;
        const order = pinnedTables.filter((t) => t !== from);
        const at = order.indexOf(target);
        if (at < 0) return;
        const fromIndex = pinnedTables.indexOf(from);
        const targetIndex = pinnedTables.indexOf(target);
        order.splice(fromIndex < targetIndex ? at + 1 : at, 0, from);
        void usePins.getState().reorder(connectionId, order);
    };

    const rowProps = (section: Section, table: TableSchema) => ({
        connectionId,
        table,
        section,
        actions,
        active: activeTable === table.name,
        pinned: pinnedSet.has(table.name),
        tabbable: tabbableKey === itemKey(section, table.name),
    });

    const startResize = (event: PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        const handle = event.currentTarget;
        const clamp = (px: number) =>
            Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px)));
        let latest = startWidth;
        handle.setPointerCapture?.(event.pointerId);
        const move = (e: globalThis.PointerEvent) => {
            latest = clamp(startWidth + e.clientX - startX);
            setDragWidth(latest);
        };
        const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', up);
            useSidebarPrefs.getState().setWidth(latest);
            setDragWidth(null);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
    };

    if (collapsed) return null;

    const shownWidth = dragWidth ?? width;

    return (
        <aside
            aria-label="Table sidebar"
            style={{ width: shownWidth }}
            className="relative flex h-full shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
        >
            <div className="relative shrink-0 p-2">
                <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                    id={SIDEBAR_SEARCH_ID}
                    type="search"
                    value={query}
                    placeholder="Search tables"
                    aria-label="Search tables"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape' && query) {
                            e.preventDefault();
                            setQuery('');
                        }
                        if (e.key === 'ArrowDown' && items.length > 0) {
                            e.preventDefault();
                            moveTo(0);
                        }
                    }}
                    className="h-8 w-full rounded-md border bg-background pr-2 pl-7 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-search-cancel-button]:appearance-none"
                />
            </div>

            <div
                role="tree"
                aria-label="Tables"
                data-sidebar-tree
                onKeyDown={onTreeKeyDown}
                className="flex min-h-0 flex-1 flex-col"
            >
                {showPinned && (
                    <div
                        role="group"
                        aria-label="Pinned"
                        className="flex max-h-[40%] shrink-0 flex-col"
                    >
                        <SectionHeader
                            label="Pinned"
                            open={openSections.pinned}
                            onToggle={() => toggleSection('pinned')}
                        />
                        {openSections.pinned && (
                            <div className="overflow-y-auto px-1">
                                {pins.map((pin) => {
                                    const t = byName.get(pin.table);
                                    if (!t)
                                        return (
                                            <div
                                                key={pin.id}
                                                className="flex h-7 items-center gap-2 pr-1 pl-2 text-sm text-muted-foreground"
                                            >
                                                <Table2
                                                    className="size-3.5 shrink-0"
                                                    aria-hidden
                                                />
                                                <span
                                                    className="min-w-0 flex-1 truncate line-through"
                                                    title={`${pin.table} no longer exists`}
                                                >
                                                    {pin.table}
                                                </span>
                                                <button
                                                    type="button"
                                                    aria-label={`Remove ${pin.table}`}
                                                    onClick={() =>
                                                        void usePins
                                                            .getState()
                                                            .toggle(
                                                                connectionId,
                                                                pin.table,
                                                            )
                                                    }
                                                    className="flex size-5 items-center justify-center rounded-sm hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                                                >
                                                    <X className="size-3.5" />
                                                </button>
                                            </div>
                                        );
                                    return (
                                        <SidebarRow
                                            key={pin.id}
                                            {...rowProps('pinned', t)}
                                            onDragStart={(n) =>
                                                (dragged.current = n)
                                            }
                                            onDropOn={dropPin}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {showRecent && (
                    <div
                        role="group"
                        aria-label="Recent"
                        className="flex max-h-[30%] shrink-0 flex-col"
                    >
                        <SectionHeader
                            label="Recent"
                            open={openSections.recent}
                            onToggle={() => toggleSection('recent')}
                        />
                        {openSections.recent && (
                            <div className="overflow-y-auto px-1">
                                {recentTables.map((name) => (
                                    <SidebarRow
                                        key={name}
                                        {...rowProps(
                                            'recent',
                                            byName.get(name)!,
                                        )}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div
                    role="group"
                    aria-label={`All tables (${allNames.length})`}
                    className="flex min-h-0 flex-1 flex-col"
                >
                    <SectionHeader
                        label={`All tables (${allNames.length})`}
                        open={openSections.all}
                        onToggle={() => toggleSection('all')}
                    />
                    {openSections.all && (
                        <div
                            ref={scrollRef}
                            data-sidebar-scroll
                            className="min-h-0 flex-1 overflow-y-auto px-1"
                        >
                            <div
                                className="relative w-full"
                                style={{ height: virtualizer.getTotalSize() }}
                            >
                                {virtualizer.getVirtualItems().map((v) => {
                                    const t = byName.get(allNames[v.index]);
                                    if (!t) return null;
                                    return (
                                        <SidebarRow
                                            key={t.name}
                                            {...rowProps('all', t)}
                                            style={{
                                                position: 'absolute',
                                                top: 0,
                                                left: 0,
                                                width: '100%',
                                                height: ROW_HEIGHT,
                                                transform: `translateY(${v.start}px)`,
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize table sidebar"
                aria-valuenow={shownWidth}
                aria-valuemin={SIDEBAR_MIN}
                aria-valuemax={SIDEBAR_MAX}
                tabIndex={0}
                onPointerDown={startResize}
                onKeyDown={(e) => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                    e.preventDefault();
                    useSidebarPrefs
                        .getState()
                        .setWidth(width + (e.key === 'ArrowRight' ? 16 : -16));
                }}
                className="absolute top-0 -right-0.5 z-10 h-full w-1 cursor-col-resize touch-none hover:bg-ring/50 focus-visible:bg-ring/50 focus-visible:outline-none"
            />
        </aside>
    );
}
