import { History, Orbit, PanelLeft, TerminalSquare } from 'lucide-react';
import { useActiveTab, useBrowse } from '@/browse/browse-store';
import { useSidebarPrefs } from '@/browse/sidebar-prefs';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/universe/store';

export function LeftRail({ connectionId }: { connectionId: number }) {
    const universeActive = useActiveTab(connectionId).kind === 'universe';
    const sidebarCollapsed = useSidebarPrefs((s) => s.collapsed);
    const dockOpen = useWorkspace((s) => s.dockOpen);
    const setDockOpen = useWorkspace((s) => s.setDockOpen);
    const historyOpen = useWorkspace((s) => s.historyOpen);
    const setHistoryOpen = useWorkspace((s) => s.setHistoryOpen);

    const item = (
        label: string,
        Icon: typeof Orbit,
        active: boolean,
        onClick: () => void,
    ) => (
        <Tooltip key={label}>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    aria-pressed={active}
                    onClick={onClick}
                    className={cn(
                        'flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors motion-reduce:transition-none',
                        'hover:bg-muted hover:text-foreground',
                        active && 'bg-muted text-foreground',
                    )}
                >
                    <Icon className="size-4" />
                </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
    );

    // A local provider keeps the rail self-contained: Radix tooltips throw
    // without one, and the app-level provider is absent when the page renders
    // on its own (tests).
    return (
        <TooltipProvider delayDuration={0}>
            <nav
                aria-label="Workspace views"
                className="flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2"
            >
                {item('Universe', Orbit, universeActive, () =>
                    useBrowse.getState().activate(connectionId, 'universe'),
                )}
                {item(
                    'Toggle table sidebar',
                    PanelLeft,
                    !sidebarCollapsed,
                    () => useSidebarPrefs.getState().toggle(),
                )}
                <div className="my-1 h-px w-6 bg-border" />
                {item('SQL', TerminalSquare, dockOpen, () =>
                    setDockOpen(!dockOpen),
                )}
                {item('History', History, historyOpen, () =>
                    setHistoryOpen(!historyOpen),
                )}
            </nav>
        </TooltipProvider>
    );
}
