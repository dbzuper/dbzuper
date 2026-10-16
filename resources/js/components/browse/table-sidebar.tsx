import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
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
/** A tree row: a table, or (table null) a section header. */
type Item = { key: string; section: Section; table: string | null };
const itemKey = (section: Section, table: string) => `${section}:${table}`;
const headerKey = (section: Section) => `header:${section}`;

/** A row's accessible name holds its visible text (name and row count), as WCAG 2.5.3 asks. */
const rowLabel = (name: string, count: string) =>
    count === '—'
        ? name
        : `${name}, ${count} ${count === '1' ? 'row' : 'rows'}`;

type RowProps = {
    connectionId: number;
    table: TableSchema;
    section: Section;
    active: boolean;
    pinned: boolean;
    tabbable: boolean;
    actions: TableActions;
    style?: CSSProperties;
    onFocusRow?: (key: string) => void;
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
    onFocusRow,
    onDragStart,
    onDropOn,
}: RowProps) {
    const name = table.name;
    const open = (event: MouseEvent) => {
        onFocusRow?.(itemKey(section, name));
        actions.open(
            name,
            event.ctrlKey || event.metaKey ? 'permanent' : 'preview',
        );
    };
    const Icon = table.kind === 'view' ? Eye : Table2;
    const count = formatRowCount(table.row_count);

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
                    aria-label={rowLabel(name, count)}
                    data-table={name}
                    data-key={itemKey(section, name)}
                    aria-keyshortcuts="*"
                    tabIndex={tabbable ? 0 : -1}
                    title={name}
                    onFocus={() => onFocusRow?.(itemKey(section, name))}
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
                    {/* The space keeps name and count apart in the row's text. */}
                    <span className="min-w-0 flex-1 truncate">{name}</span>{' '}
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {count}
                    </span>
                    {/* Inside the treeitem: a tree may only own groups and treeitems. It is a pointer
                        shortcut; the keyboard pins with * and the context menu. */}
                    <button
                        type="button"
                        tabIndex={-1}
                        title={pinned ? 'Unpin (*)' : 'Pin (*)'}
                        aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
                        onMouseDown={(e) => {
                            // Keeps focus (and the click) away from the row.
                            e.preventDefault();
                            e.stopPropagation();
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            void usePins.getState().toggle(connectionId, name);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        onAuxClick={(e) => e.stopPropagation()}
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
            </div>
        </TableContextMenu>
    );
}

/**
 * A section header is a treeitem (a tree may only own groups and treeitems): it is in the arrow-key
 * order, and click, Enter, Space or Left/Right collapse and expand its section.
 */
function SectionHeader({
    section,
    label,
    open,
    tabbable,
    onToggle,
    onFocusRow,
}: {
    section: Section;
    label: string;
    open: boolean;
    tabbable: boolean;
    onToggle: () => void;
    onFocusRow: (key: string) => void;
}) {
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
        <div
            role="treeitem"
            aria-expanded={open}
            aria-label={label}
            data-key={headerKey(section)}
            tabIndex={tabbable ? 0 : -1}
            onFocus={() => onFocusRow(headerKey(section))}
            onClick={onToggle}
            className="flex h-7 w-full shrink-0 cursor-default items-center gap-1 rounded-sm px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase outline-none select-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
            <Chevron className="size-3.5" aria-hidden />
            {label}
        </div>
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
    const liveRecents = useBrowse(
        (s) => s.byConnection[connectionId]?.recents ?? NO_RECENTS,
    );
    // Opening a table moves it to the top of Recent (and may add the section). While the pointer is
    // in the tree the rows stay where they are, so the second click of a double-click lands on the
    // same table as the first; the list catches up when the pointer leaves.
    const [frozenRecents, setFrozenRecents] = useState<string[] | null>(null);
    const recents = frozenRecents ?? liveRecents;
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
        const add = (section: Section, tables: string[]) => {
            out.push({ key: headerKey(section), section, table: null });
            if (!openSections[section]) return;
            tables.forEach((table) =>
                out.push({ key: itemKey(section, table), section, table }),
            );
        };
        if (showPinned)
            add(
                'pinned',
                pinnedTables.filter((t) => byName.has(t)),
            );
        if (showRecent) add('recent', recentTables);
        add('all', allNames);
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

    const tabbableKey =
        focusKey && items.some((i) => i.key === focusKey)
            ? focusKey
            : (items[0]?.key ?? null);

    // The tabbable row must stay mounted, or the tree would have no tab stop.
    const tabbableAllIndex =
        tabbableKey?.startsWith('all:') && openSections.all
            ? allNames.indexOf(tabbableKey.slice(4))
            : -1;

    const virtualizer = useVirtualizer({
        count: openSections.all ? allNames.length : 0,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 12,
        rangeExtractor: (range) => {
            const indexes = defaultRangeExtractor(range);
            if (tabbableAllIndex < 0 || indexes.includes(tabbableAllIndex))
                return indexes;
            return [...indexes, tabbableAllIndex].sort((a, b) => a - b);
        },
    });

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
        if (item.section === 'all' && item.table !== null)
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

        if (item.table === null) {
            const open = openSections[item.section];
            if (
                event.key === 'Enter' ||
                event.key === ' ' ||
                (event.key === 'ArrowRight' && !open) ||
                (event.key === 'ArrowLeft' && open)
            ) {
                event.preventDefault();
                return toggleSection(item.section);
            }
        }

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
        }
        const table = item.table;
        if (table === null) return;
        switch (event.key) {
            case 'Enter':
                event.preventDefault();
                return actions.open(table, 'permanent');
            case ' ':
                event.preventDefault();
                return actions.open(table, 'preview');
            case '*':
                event.preventDefault();
                return void usePins.getState().toggle(connectionId, table);
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
            if (items[at].table?.toLowerCase().startsWith(buffer))
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
        onFocusRow: setFocusKey,
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
                            // The first table, past its section header.
                            moveTo(
                                Math.max(
                                    0,
                                    items.findIndex((i) => i.table !== null),
                                ),
                            );
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
                onPointerEnter={() => setFrozenRecents(liveRecents)}
                onPointerLeave={() => setFrozenRecents(null)}
                className="flex min-h-0 flex-1 flex-col"
            >
                {showPinned && (
                    <div
                        role="group"
                        aria-label="Pinned"
                        className="flex max-h-[40%] shrink-0 flex-col"
                    >
                        <SectionHeader
                            section="pinned"
                            label="Pinned"
                            open={openSections.pinned}
                            tabbable={tabbableKey === headerKey('pinned')}
                            onToggle={() => toggleSection('pinned')}
                            onFocusRow={setFocusKey}
                        />
                        {openSections.pinned && (
                            <div className="overflow-y-auto px-1">
                                {pins.map((pin) => {
                                    const t = byName.get(pin.table);
                                    if (!t)
                                        return (
                                            <div
                                                key={pin.id}
                                                role="treeitem"
                                                aria-disabled="true"
                                                aria-label={`${pin.table} (no longer exists)`}
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
                            section="recent"
                            label="Recent"
                            open={openSections.recent}
                            tabbable={tabbableKey === headerKey('recent')}
                            onToggle={() => toggleSection('recent')}
                            onFocusRow={setFocusKey}
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
                        section="all"
                        label={`All tables (${allNames.length})`}
                        open={openSections.all}
                        tabbable={tabbableKey === headerKey('all')}
                        onToggle={() => toggleSection('all')}
                        onFocusRow={setFocusKey}
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
