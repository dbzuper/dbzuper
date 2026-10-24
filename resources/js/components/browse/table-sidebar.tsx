import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import {
    ChevronDown,
    ChevronRight,
    Eye,
    FolderTree,
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
    type ReactNode,
} from 'react';
import { useBrowse } from '@/browse/browse-store';
import {
    readGroupingEnabled,
    readGroupPrefs,
    SIDEBAR_MAX,
    SIDEBAR_MIN,
    writeGroupingEnabled,
    writeGroupPrefs,
} from '@/browse/local-prefs';
import { usePins } from '@/browse/pins-store';
import { useSidebarPrefs } from '@/browse/sidebar-prefs';
import { flattenEntries, groupTables } from '@/browse/table-groups';
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
/** Recent shows the latest few unpinned tables; the store keeps more (MAX_RECENTS) so pins can be skipped. */
const SIDEBAR_RECENTS = 5;

type Section = 'pinned' | 'recent' | 'all';
/**
 * A tree row: a table, or (table null) a section header or, with `group` set, a prefix group in All
 * tables. `missing` marks a pin whose table no longer exists; `prefix` marks a table inside a group.
 */
type Item = {
    key: string;
    section: Section;
    table: string | null;
    missing?: boolean;
    group?: string;
    /** A group row's number of tables. */
    size?: number;
    prefix?: string;
};
const itemKey = (section: Section, table: string) => `${section}:${table}`;
const headerKey = (section: Section) => `header:${section}`;
const groupRowKey = (prefix: string) => `group:${prefix}`;

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
    /** Set when the row sits inside a prefix group in All tables. */
    prefix?: string;
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
    prefix,
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
                    aria-level={prefix ? 3 : 2}
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
                        'flex h-7 min-w-0 flex-1 cursor-default items-center gap-2 rounded-sm pr-7 text-sm outline-none select-none',
                        // A grouped table sits pl-5 further in than a loose one.
                        prefix ? 'pl-7' : 'pl-2',
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
                    <span className="min-w-0 flex-1 truncate">
                        {prefix && name.startsWith(prefix) ? (
                            <>
                                <span className="text-muted-foreground">
                                    {prefix}
                                </span>
                                {name.slice(prefix.length)}
                            </>
                        ) : (
                            name
                        )}
                    </span>{' '}
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
    children,
}: {
    section: Section;
    label: string;
    open: boolean;
    tabbable: boolean;
    onToggle: () => void;
    onFocusRow: (key: string) => void;
    children?: ReactNode;
}) {
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
        <div
            role="treeitem"
            aria-level={1}
            aria-expanded={open}
            aria-label={label}
            data-key={headerKey(section)}
            tabIndex={tabbable ? 0 : -1}
            onFocus={(e) => {
                // Focus on a control inside the header is not the header's.
                if (e.target === e.currentTarget)
                    onFocusRow(headerKey(section));
            }}
            onClick={onToggle}
            className="flex h-7 w-full shrink-0 cursor-default items-center gap-1 rounded-sm px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase outline-none select-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
            <Chevron className="size-3.5" aria-hidden />
            {label}
            {children}
        </div>
    );
}

/** A prefix group in All tables: click, Enter, Space or Left/Right collapse and expand it. */
function GroupRow({
    prefix,
    size,
    open,
    tabbable,
    style,
    onToggle,
    onFocusRow,
}: {
    prefix: string;
    size: number;
    open: boolean;
    tabbable: boolean;
    style: CSSProperties;
    onToggle: () => void;
    onFocusRow: (key: string) => void;
}) {
    const Chevron = open ? ChevronDown : ChevronRight;
    const key = groupRowKey(prefix);
    return (
        <div
            role="treeitem"
            aria-level={2}
            aria-expanded={open}
            data-key={key}
            tabIndex={tabbable ? 0 : -1}
            title={prefix}
            style={style}
            onFocus={() => onFocusRow(key)}
            onClick={() => {
                onFocusRow(key);
                onToggle();
            }}
            className="flex h-7 cursor-default items-center gap-2 rounded-sm pr-7 pl-2 text-sm outline-none select-none hover:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring"
        >
            <Chevron
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
            />
            {/* The name comes from the content ("courier_ group, 2 tables"), so it holds the
                visible text, as WCAG 2.5.3 asks. */}
            <span className="min-w-0 flex-1 truncate">{prefix}</span>{' '}
            <span className="sr-only">group,</span>{' '}
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {size}
            </span>{' '}
            <span className="sr-only">tables</span>
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
    const [grouping, setGrouping] = useState(readGroupingEnabled);
    // The open prefix groups of this connection; the active table's group is opened too, unsaved.
    const [groups, setGroups] = useState(() => ({
        connectionId,
        open: new Set(readGroupPrefs(connectionId).open),
    }));
    // Another connection starts from its own saved groups, in this render too (not the old set).
    const groupsStale = groups.connectionId !== connectionId;
    const openGroups = groupsStale
        ? new Set(readGroupPrefs(connectionId).open)
        : groups.open;
    if (groupsStale) setGroups({ connectionId, open: openGroups });
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
    const tableGroups = useMemo(
        () =>
            grouping
                ? groupTables(snapshot.tables.map((t) => t.name)).entries
                : null,
        [grouping, snapshot],
    );
    const groupOf = useMemo(() => {
        const map = new Map<string, string>();
        for (const entry of tableGroups ?? [])
            if (entry.kind === 'group')
                for (const name of entry.tables) map.set(name, entry.prefix);
        return map;
    }, [tableGroups]);

    // On mount and whenever the active table changes, its group opens (not saved to the prefs).
    const [seenActive, setSeenActive] = useState<{
        connectionId: number;
        table: string | null;
    } | null>(null);
    if (
        seenActive?.connectionId !== connectionId ||
        seenActive.table !== activeTable
    ) {
        setSeenActive({ connectionId, table: activeTable });
        const prefix = activeTable ? groupOf.get(activeTable) : undefined;
        if (prefix && !openGroups.has(prefix))
            setGroups({
                connectionId,
                open: new Set(openGroups).add(prefix),
            });
    }

    // While searching, or with grouping off, All tables is the flat list.
    const allItems = useMemo<Item[]>(() => {
        if (!tableGroups || searching)
            return allNames.map((table) => ({
                key: itemKey('all', table),
                section: 'all',
                table,
            }));
        return flattenEntries(tableGroups, openGroups).map((entry): Item =>
            entry.kind === 'group'
                ? {
                      key: groupRowKey(entry.prefix),
                      section: 'all',
                      table: null,
                      group: entry.prefix,
                      size: entry.tables.length,
                  }
                : {
                      key: itemKey('all', entry.name),
                      section: 'all',
                      table: entry.name,
                      prefix: entry.prefix ?? undefined,
                  },
        );
    }, [tableGroups, searching, allNames, openGroups]);
    const pinnedTables = useMemo(() => pins.map((p) => p.table), [pins]);
    const pinnedSet = useMemo(() => new Set(pinnedTables), [pinnedTables]);
    // Pinned tables are already one click away, so Recent skips them; it stays short so All tables keeps its room.
    const recentTables = useMemo(
        () =>
            recents
                .filter((t) => byName.has(t) && !pinnedSet.has(t))
                .slice(0, SIDEBAR_RECENTS),
        [recents, byName, pinnedSet],
    );

    const showPinned = !searching && pins.length > 0;
    const showRecent = !searching && recentTables.length > 0;

    const items = useMemo<Item[]>(() => {
        const out: Item[] = [];
        const add = (section: Section, tables: string[]) => {
            out.push({ key: headerKey(section), section, table: null });
            if (!openSections[section]) return;
            tables.forEach((table) =>
                out.push({
                    key: itemKey(section, table),
                    section,
                    table,
                    // Only pins can name a table the schema no longer has.
                    missing: !byName.has(table) || undefined,
                }),
            );
        };
        if (showPinned) add('pinned', pinnedTables);
        if (showRecent) add('recent', recentTables);
        out.push({ key: headerKey('all'), section: 'all', table: null });
        if (openSections.all) for (const item of allItems) out.push(item);
        return out;
    }, [
        showPinned,
        showRecent,
        openSections,
        pinnedTables,
        recentTables,
        allItems,
        byName,
    ]);
    // Where All tables' (virtualized) rows start in `items`.
    const allStart = items.length - (openSections.all ? allItems.length : 0);

    const hasKey = (key: string) => items.some((i) => i.key === key);
    // A table hidden in a closed group hands its tab stop to the group's row.
    const hiddenIn = focusKey?.startsWith('all:')
        ? groupOf.get(focusKey.slice(4))
        : undefined;
    const tabbableKey =
        focusKey && hasKey(focusKey)
            ? focusKey
            : hiddenIn && hasKey(groupRowKey(hiddenIn))
              ? groupRowKey(hiddenIn)
              : (items[0]?.key ?? null);

    // The tabbable row must stay mounted, or the tree would have no tab stop.
    const tabbableAllIndex =
        tabbableKey && openSections.all
            ? allItems.findIndex((i) => i.key === tabbableKey)
            : -1;

    const virtualizer = useVirtualizer({
        count: openSections.all ? allItems.length : 0,
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
        if (index >= allStart) virtualizer.scrollToIndex(index - allStart);
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

        if (item.group !== undefined) {
            const prefix = item.group;
            const open = openGroups.has(prefix);
            if (
                event.key === 'Enter' ||
                event.key === ' ' ||
                (event.key === 'ArrowRight' && !open) ||
                (event.key === 'ArrowLeft' && open)
            ) {
                event.preventDefault();
                return toggleGroup(prefix);
            }
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                return moveTo(index + 1);
            }
        } else if (item.table === null) {
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

        if (item.prefix && event.key === 'ArrowLeft') {
            event.preventDefault();
            const prefix = item.prefix;
            return moveTo(items.findIndex((i) => i.group === prefix));
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
        // Group and section header rows type ahead too; they have no other single-character keys.
        if (table === null) return typeAhead(event, index);
        if (item.missing) {
            // A pin of a dropped table can only be removed; focus moves on to its neighbour.
            if (!['Delete', 'Backspace', '*'].includes(event.key)) return;
            event.preventDefault();
            const next = items[index + 1] ?? items[index - 1];
            if (next) {
                pendingFocus.current = next.key;
                setFocusKey(next.key);
            }
            return void usePins.getState().toggle(connectionId, table);
        }
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

        return typeAhead(event, index);
    };

    const typeAhead = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
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

    // Only these user toggles are saved; auto-opened groups stay unsaved.
    const toggleGroup = (prefix: string) => {
        const open = new Set(openGroups);
        const saved = readGroupPrefs(connectionId).open.filter(
            (p) => p !== prefix,
        );
        if (open.has(prefix)) open.delete(prefix);
        else {
            open.add(prefix);
            saved.push(prefix);
        }
        setGroups({ connectionId, open });
        writeGroupPrefs(connectionId, { open: saved });
    };

    const toggleGrouping = () => {
        writeGroupingEnabled(!grouping);
        setGrouping(!grouping);
    };

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
                            // The first table or group, past its section header.
                            moveTo(
                                Math.max(
                                    0,
                                    items.findIndex(
                                        (i) =>
                                            i.table !== null ||
                                            i.group !== undefined,
                                    ),
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
                                    const key = itemKey('pinned', pin.table);
                                    if (!t)
                                        return (
                                            <div
                                                key={pin.id}
                                                role="treeitem"
                                                aria-level={2}
                                                aria-disabled="true"
                                                aria-label={`${pin.table} (no longer exists)`}
                                                aria-keyshortcuts="Delete *"
                                                data-key={key}
                                                tabIndex={
                                                    tabbableKey === key ? 0 : -1
                                                }
                                                onFocus={() => setFocusKey(key)}
                                                className="flex h-7 items-center gap-2 rounded-sm pr-1 pl-2 text-sm text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                                                {/* A pointer shortcut: the keyboard removes the pin with Delete or *. */}
                                                <button
                                                    type="button"
                                                    tabIndex={-1}
                                                    title="Remove (Delete)"
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
                    >
                        {/* Inside the header treeitem (a tree may only own groups and treeitems), but
                            not a treeitem: its own tab stop, outside the arrow-key order. */}
                        {!searching && (
                            <button
                                type="button"
                                title="Group by prefix"
                                aria-label="Group by prefix"
                                aria-pressed={grouping}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggleGrouping();
                                }}
                                className={cn(
                                    'ml-auto flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring',
                                    grouping &&
                                        'bg-accent text-accent-foreground',
                                )}
                            >
                                <FolderTree className="size-3.5" />
                            </button>
                        )}
                    </SectionHeader>
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
                                    const item = allItems[v.index];
                                    if (!item) return null;
                                    const style: CSSProperties = {
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        height: ROW_HEIGHT,
                                        transform: `translateY(${v.start}px)`,
                                    };
                                    const prefix = item.group;
                                    if (prefix !== undefined)
                                        return (
                                            <GroupRow
                                                key={item.key}
                                                prefix={prefix}
                                                size={item.size ?? 0}
                                                open={openGroups.has(prefix)}
                                                tabbable={
                                                    tabbableKey === item.key
                                                }
                                                style={style}
                                                onToggle={() =>
                                                    toggleGroup(prefix)
                                                }
                                                onFocusRow={setFocusKey}
                                            />
                                        );
                                    const t = item.table
                                        ? byName.get(item.table)
                                        : undefined;
                                    if (!t) return null;
                                    return (
                                        <SidebarRow
                                            key={item.key}
                                            {...rowProps('all', t)}
                                            prefix={item.prefix}
                                            style={style}
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
