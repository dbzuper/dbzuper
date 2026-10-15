import { X } from 'lucide-react';
import { useWorkspace } from '@/universe/store';

/** Makes a pending path pick visible: the next table clicked or searched ends the path. */
export function PathPickChip() {
    const pathFrom = useWorkspace((s) => s.pathFrom);
    const pending = useWorkspace((s) => s.pathFrom !== null && s.path === null);
    const focused = useWorkspace((s) => s.focus !== null);
    const clearPath = useWorkspace((s) => s.clearPath);
    if (!pending) return null;
    return (
        <div
            role="status"
            className={`absolute ${focused ? 'top-12' : 'top-3'} left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--universe-accent)] bg-background/90 px-3 py-1 text-xs shadow-sm backdrop-blur`}
        >
            <span>
                Path from{' '}
                <span className="font-mono font-medium">{pathFrom}</span>: click
                a table or search · Esc to cancel
            </span>
            <button
                type="button"
                aria-label="Cancel path"
                onClick={() => clearPath()}
                className="text-muted-foreground hover:text-foreground"
            >
                <X className="size-3.5" />
            </button>
        </div>
    );
}
