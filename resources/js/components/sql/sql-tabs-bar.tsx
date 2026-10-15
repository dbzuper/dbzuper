import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSqlTabs } from '@/sql/tabs-store';

export function SqlTabsBar({ connectionId }: { connectionId: number }) {
    const state = useSqlTabs((s) => s.byConnection[connectionId]);
    const setActive = useSqlTabs((s) => s.setActive);
    const closeTab = useSqlTabs((s) => s.closeTab);
    const openTab = useSqlTabs((s) => s.openTab);

    return (
        <div
            role="tablist"
            aria-label="SQL tabs"
            className="flex min-w-0 items-center gap-1 overflow-x-auto"
        >
            {state?.tabs.map((tab) => {
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
                            role="tab"
                            aria-selected={active}
                            className="max-w-40 truncate py-1 pr-1 pl-2.5"
                            onClick={() => setActive(connectionId, tab.id)}
                        >
                            {tab.title}
                        </button>
                        <button
                            type="button"
                            aria-label={`Close ${tab.title}`}
                            className="mr-1 rounded p-0.5 hover:bg-background"
                            onClick={() => closeTab(connectionId, tab.id)}
                        >
                            <X className="size-3" />
                        </button>
                    </div>
                );
            })}
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
