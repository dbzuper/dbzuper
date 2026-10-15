import { X } from 'lucide-react';
import { useWorkspace } from '@/universe/store';

export function FocusChip() {
    const focus = useWorkspace((s) => s.focus);
    const setFocus = useWorkspace((s) => s.setFocus);
    if (!focus) return null;
    return (
        <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/90 px-3 py-1 text-xs shadow-sm backdrop-blur">
            <span>
                Focus:{' '}
                <span className="font-mono font-medium">{focus.table}</span>
            </span>
            <div
                role="group"
                aria-label="Neighbourhood depth"
                className="flex overflow-hidden rounded-full border"
            >
                {([1, 2] as const).map((d) => (
                    <button
                        key={d}
                        type="button"
                        aria-pressed={focus.depth === d}
                        onClick={() => setFocus(focus.table, d)}
                        className={
                            focus.depth === d
                                ? 'bg-muted px-2 py-0.5'
                                : 'px-2 py-0.5 text-muted-foreground'
                        }
                    >
                        {d} hop{d === 2 ? 's' : ''}
                    </button>
                ))}
            </div>
            <button
                type="button"
                aria-label="Exit focus"
                onClick={() => setFocus(null)}
                className="text-muted-foreground hover:text-foreground"
            >
                <X className="size-3.5" />
            </button>
        </div>
    );
}
