import { Plus, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSqlTabs } from '@/sql/tabs-store';

const tabDomId = (tabId: string) => `sql-tab-${tabId}`;

export function SqlTabsBar({ connectionId }: { connectionId: number }) {
    const state = useSqlTabs((s) => s.byConnection[connectionId]);
    const setActive = useSqlTabs((s) => s.setActive);
    const closeTab = useSqlTabs((s) => s.closeTab);
    const openTab = useSqlTabs((s) => s.openTab);

    // After a keyboard close, focus follows to the tab that became active.
    const refocus = useRef(false);
    const activeId = state?.activeId;
    useEffect(() => {
        if (!refocus.current) return;
        refocus.current = false;
        if (activeId) document.getElementById(tabDomId(activeId))?.focus();
    }, [activeId, state?.tabs.length]);

    const onKeyDown = (e: React.KeyboardEvent, index: number) => {
        const tabs = state?.tabs ?? [];
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            refocus.current = true;
            closeTab(connectionId, tabs[index].id);
            return;
        }
        const target =
            e.key === 'ArrowRight'
                ? (index + 1) % tabs.length
                : e.key === 'ArrowLeft'
                  ? (index - 1 + tabs.length) % tabs.length
                  : e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? tabs.length - 1
                      : null;
        if (target === null) return;
        e.preventDefault();
        setActive(connectionId, tabs[target].id);
        document.getElementById(tabDomId(tabs[target].id))?.focus();
    };

    return (
        // Padding keeps the focus ring of a tab inside the scroll container.
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-1 py-1">
            <div
                role="tablist"
                aria-label="SQL tabs"
                className="flex items-center gap-1"
            >
                {state?.tabs.map((tab, index) => {
                    const active = tab.id === state.activeId;
                    return (
                        <div
                            key={tab.id}
                            className={cn(
                                'flex items-center rounded-md text-xs',
                                active
                                    ? 'bg-muted text-foreground'
                                    : 'text-muted-foreground hover:bg-muted/60',
                            )}
                        >
                            <button
                                type="button"
                                id={tabDomId(tab.id)}
                                role="tab"
                                aria-selected={active}
                                tabIndex={active ? 0 : -1}
                                className="max-w-40 truncate rounded-md py-1 pr-1 pl-2.5"
                                onClick={() => setActive(connectionId, tab.id)}
                                onKeyDown={(e) => onKeyDown(e, index)}
                            >
                                {tab.title}
                            </button>
                            {/* Mouse-only: keyboard users close a tab with Delete or Backspace on it. */}
                            <button
                                type="button"
                                aria-hidden="true"
                                tabIndex={-1}
                                title="Close"
                                className="mr-1 rounded p-0.5 hover:bg-background"
                                onClick={() => closeTab(connectionId, tab.id)}
                            >
                                <X className="size-3" />
                            </button>
                        </div>
                    );
                })}
            </div>
            <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label="New query tab"
                onClick={() => openTab(connectionId)}
            >
                <Plus className="size-4" />
            </Button>
        </div>
    );
}
