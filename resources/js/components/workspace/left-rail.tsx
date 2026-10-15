import { Database, History, List, Orbit, TerminalSquare } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/universe/store';

export function LeftRail({
    universeAvailable,
}: {
    universeAvailable: boolean;
}) {
    const view = useWorkspace((s) => s.view);
    const setView = useWorkspace((s) => s.setView);
    const dockOpen = useWorkspace((s) => s.dockOpen);
    const setDockOpen = useWorkspace((s) => s.setDockOpen);
    const historyOpen = useWorkspace((s) => s.historyOpen);
    const setHistoryOpen = useWorkspace((s) => s.setHistoryOpen);

    const item = (
        label: string,
        Icon: typeof Orbit,
        active: boolean,
        onClick?: () => void,
        isDisabled = false,
    ) => (
        <Tooltip key={label}>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    aria-pressed={active}
                    disabled={isDisabled}
                    onClick={onClick}
                    className={cn(
                        'flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors motion-reduce:transition-none',
                        active && 'bg-muted text-foreground',
                        !isDisabled && 'hover:bg-muted hover:text-foreground',
                        isDisabled && 'opacity-40',
                    )}
                >
                    <Icon className="size-4" />
                </button>
            </TooltipTrigger>
            <TooltipContent side="right">
                {isDisabled ? `${label} — coming soon` : label}
            </TooltipContent>
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
                {item(
                    'Universe',
                    Orbit,
                    view === 'universe',
                    () => setView('universe'),
                    !universeAvailable,
                )}
                {item('List view', List, view === 'list', () =>
                    setView('list'),
                )}
                <div className="my-1 h-px w-6 bg-border" />
                {item('Records', Database, false, undefined, true)}
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
