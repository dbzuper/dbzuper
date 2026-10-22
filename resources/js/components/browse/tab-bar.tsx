import { ChevronDown, Database, Orbit, Table2, X } from 'lucide-react';
import {
    useEffect,
    useRef,
    useState,
    type DragEvent,
    type KeyboardEvent,
    type MouseEvent,
} from 'react';
import {
    filterSummary,
    tabTitle,
    UNIVERSE_TAB,
    useBrowse,
    type BrowseTab,
} from '@/browse/browse-store';
import { usePins } from '@/browse/pins-store';
import type { TableActions } from '@/components/browse/table-context-menu';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { writeClipboard } from '@/grid/copy';
import { cn } from '@/lib/utils';

export const panelDomId = 'browse-panel';
export const tabDomId = (id: string) =>
    `browse-tab-${Array.from(new TextEncoder().encode(id))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}`;

const ONLY_UNIVERSE: BrowseTab[] = [UNIVERSE_TAB];

const titleOf = (tab: BrowseTab) =>
    tab.kind === 'universe'
        ? 'Universe'
        : tab.kind === 'records'
          ? tab.title
          : tabTitle(tab);

function TabIcon({ tab }: { tab: BrowseTab }) {
    const cls = 'size-3.5 shrink-0';
    if (tab.kind === 'universe') return <Orbit className={cls} />;
    if (tab.kind === 'records') return <Database className={cls} />;
    return <Table2 className={cls} />;
}

function TabMenu({
    connectionId,
    tab,
    children,
}: {
    connectionId: number;
    tab: BrowseTab;
    children: React.ReactNode;
}) {
    const pinned = usePins((s) =>
        tab.kind === 'table'
            ? s.byConnection[connectionId]?.some((p) => p.table === tab.table)
            : false,
    );
    const store = useBrowse.getState;
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent>
                {tab.kind !== 'universe' && (
                    <>
                        <ContextMenuItem
                            onSelect={() =>
                                tab.kind === 'records'
                                    ? store().closeRecords(connectionId)
                                    : store().closeTab(connectionId, tab.id)
                            }
                        >
                            Close
                        </ContextMenuItem>
                    </>
                )}
                <ContextMenuItem
                    onSelect={() => store().closeOthers(connectionId, tab.id)}
                >
                    Close others
                </ContextMenuItem>
                {tab.kind !== 'universe' && (
                    <ContextMenuItem
                        onSelect={() =>
                            store().closeRight(connectionId, tab.id)
                        }
                    >
                        Close to the right
                    </ContextMenuItem>
                )}
                <ContextMenuItem
                    onSelect={() => store().closeAll(connectionId)}
                >
                    Close all
                </ContextMenuItem>
                {tab.kind === 'table' && (
                    <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                            onSelect={() =>
                                store().duplicateTab(connectionId, tab.id)
                            }
                        >
                            Duplicate tab
                        </ContextMenuItem>
                        <ContextMenuItem
                            onSelect={() =>
                                void usePins
                                    .getState()
                                    .toggle(connectionId, tab.table)
                            }
                        >
                            {pinned ? 'Unpin' : 'Pin'}
                        </ContextMenuItem>
                        <ContextMenuItem
                            onSelect={() => void writeClipboard(tab.table)}
                        >
                            Copy name
                        </ContextMenuItem>
                    </>
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}

export function TabBar({
    connectionId,
}: {
    connectionId: number;
    actions: TableActions;
}) {
    const tabs =
        useBrowse((s) => s.byConnection[connectionId]?.tabs) ?? ONLY_UNIVERSE;
    const activeId =
        useBrowse((s) => s.byConnection[connectionId]?.activeId) ?? 'universe';
    const refs = useRef(new Map<string, HTMLButtonElement>());
    const [dragId, setDragId] = useState<string | null>(null);
    const [overId, setOverId] = useState<string | null>(null);

    useEffect(() => {
        refs.current
            .get(activeId)
            ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }, [activeId]);

    // Closing a tab unmounts the focused element; hand focus to the active tab.
    const prevCount = useRef(tabs.length);
    useEffect(() => {
        const shrank = tabs.length < prevCount.current;
        prevCount.current = tabs.length;
        if (!shrank) return;
        const a = document.activeElement;
        if (!a || a === document.body) refs.current.get(activeId)?.focus();
    }, [tabs, activeId]);

    const act = useBrowse.getState;
    const close = (tab: BrowseTab) => {
        if (tab.kind === 'universe') return;
        if (tab.kind === 'records') act().closeRecords(connectionId);
        else act().closeTab(connectionId, tab.id);
    };

    const focusAt = (i: number) => {
        const n = tabs.length;
        refs.current.get(tabs[((i % n) + n) % n].id)?.focus();
    };

    const onKeyDown = (e: KeyboardEvent, tab: BrowseTab, index: number) => {
        switch (e.key) {
            case 'ArrowRight':
                e.preventDefault();
                focusAt(index + 1);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                focusAt(index - 1);
                break;
            case 'Home':
                e.preventDefault();
                focusAt(0);
                break;
            case 'End':
                e.preventDefault();
                focusAt(tabs.length - 1);
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                act().activate(connectionId, tab.id);
                break;
            case 'Delete':
                e.preventDefault();
                close(tab);
                break;
        }
    };

    const onDrop = (e: DragEvent, index: number) => {
        e.preventDefault();
        if (dragId && dragId !== tabs[index].id)
            act().move(connectionId, dragId, Math.max(index, 1) - 1);
        setDragId(null);
        setOverId(null);
    };

    return (
        <div className="flex items-stretch border-b bg-muted/30">
            <div
                role="tablist"
                aria-label="Open tabs"
                className="flex min-w-0 flex-1 [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden"
            >
                {tabs.map((tab, index) => {
                    const active = tab.id === activeId;
                    const preview = tab.kind === 'table' && tab.preview;
                    const title = titleOf(tab);
                    const summary =
                        tab.kind === 'table' ? filterSummary(tab.state) : '';
                    const draggable = tab.kind !== 'universe';
                    return (
                        <TabMenu
                            key={tab.id}
                            connectionId={connectionId}
                            tab={tab}
                        >
                            <div
                                className={cn(
                                    'group relative flex shrink-0 items-center border-r text-sm',
                                    active
                                        ? 'bg-background'
                                        : 'text-muted-foreground hover:bg-muted/60',
                                    overId === tab.id &&
                                        dragId !== tab.id &&
                                        'ring-1 ring-primary ring-inset',
                                )}
                                onDragOver={(e) => {
                                    if (!dragId) return;
                                    e.preventDefault();
                                    setOverId(tab.id);
                                }}
                                onDragLeave={(e) => {
                                    if (
                                        !e.currentTarget.contains(
                                            e.relatedTarget as Node | null,
                                        )
                                    )
                                        setOverId((o) =>
                                            o === tab.id ? null : o,
                                        );
                                }}
                                onDrop={(e) => onDrop(e, index)}
                            >
                                <button
                                    type="button"
                                    role="tab"
                                    id={tabDomId(tab.id)}
                                    aria-selected={active}
                                    aria-controls={panelDomId}
                                    title={summary || undefined}
                                    tabIndex={active ? 0 : -1}
                                    data-preview={preview ? 'true' : undefined}
                                    aria-keyshortcuts={
                                        tab.kind !== 'universe'
                                            ? 'Delete'
                                            : undefined
                                    }
                                    draggable={draggable}
                                    ref={(el) => {
                                        if (el) refs.current.set(tab.id, el);
                                        else refs.current.delete(tab.id);
                                    }}
                                    className={cn(
                                        'flex max-w-56 items-center gap-1.5 py-1.5 pl-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                                        tab.kind === 'universe'
                                            ? 'pr-3'
                                            : 'pr-1',
                                        preview && 'italic',
                                    )}
                                    onClick={() =>
                                        act().activate(connectionId, tab.id)
                                    }
                                    onDoubleClick={() => {
                                        if (preview)
                                            act().promote(connectionId, tab.id);
                                    }}
                                    onMouseDown={(e) => {
                                        if (e.button === 1) e.preventDefault();
                                    }}
                                    onAuxClick={(e: MouseEvent) => {
                                        if (e.button === 1) {
                                            e.preventDefault();
                                            close(tab);
                                        }
                                    }}
                                    onKeyDown={(e) => onKeyDown(e, tab, index)}
                                    onDragStart={(e) => {
                                        if (!draggable) return;
                                        e.dataTransfer.effectAllowed = 'move';
                                        e.dataTransfer.setData(
                                            'text/plain',
                                            tab.id,
                                        );
                                        setDragId(tab.id);
                                    }}
                                    onDragEnd={() => {
                                        setDragId(null);
                                        setOverId(null);
                                    }}
                                >
                                    <TabIcon tab={tab} />
                                    <span className="truncate">{title}</span>
                                </button>
                                {/* A tablist may only own tabs, so the close button is a pointer
                                    shortcut hidden from assistive tech: Delete on the tab and the
                                    tab's context menu close it too. */}
                                {tab.kind !== 'universe' && (
                                    <button
                                        type="button"
                                        tabIndex={-1}
                                        aria-hidden="true"
                                        title={`Close ${title}`}
                                        aria-label={`Close ${title}`}
                                        className="mr-1 rounded p-0.5 opacity-60 group-hover:opacity-100 hover:bg-muted hover:opacity-100"
                                        onClick={() => close(tab)}
                                    >
                                        <X className="size-3" />
                                    </button>
                                )}
                            </div>
                        </TabMenu>
                    );
                })}
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger
                    aria-label="All tabs"
                    className="shrink-0 border-l px-2 text-muted-foreground hover:bg-muted/60"
                >
                    <ChevronDown className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {tabs.map((tab) => (
                        <DropdownMenuItem
                            key={tab.id}
                            onSelect={() =>
                                act().activate(connectionId, tab.id)
                            }
                        >
                            <TabIcon tab={tab} />
                            {titleOf(tab)}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
