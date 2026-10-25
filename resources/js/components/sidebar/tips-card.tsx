import { ChevronLeft, ChevronRight, Lightbulb, X } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { safeStorage } from '@/browse/safe-storage';
import { useSidebarExpanded } from '@/components/sidebar/use-sidebar-expanded';
import { Button } from '@/components/ui/button';
import { dockShortcutHint, paletteShortcutHint } from '@/lib/platform';
import { cn } from '@/lib/utils';

export const TIPS_STORAGE_KEY = 'dbsuperb.tips';

function Key({ children }: { children: ReactNode }) {
    return (
        <kbd className="rounded-[5px] border border-b-2 border-border bg-muted px-1.5 py-px font-mono text-[10.5px] text-foreground">
            {children}
        </kbd>
    );
}

/** A platform hint such as "Ctrl K" as one key per word ("⌘K" stays a single key). */
function Keys({ hint }: { hint: string }) {
    const parts = hint.split(' ');
    return parts.map((part, i) => (
        <span key={part}>
            <Key>{part}</Key>
            {i < parts.length - 1 && ' '}
        </span>
    ));
}

const TIPS: readonly (() => ReactNode)[] = [
    () => (
        <>
            Inside a workspace, press <Keys hint={paletteShortcutHint()} /> to
            jump to any table, column or saved query.
        </>
    ),
    () => (
        <>
            Press <Keys hint={dockShortcutHint()} /> to open the SQL panel.
        </>
    ),
    () => (
        <>
            <Key>Alt</Key> + <Key>↓</Key> opens the date picker in a date filter
            or cell.
        </>
    ),
    () => (
        <>
            Press <Key>*</Key> on a table in the sidebar to pin it.
        </>
    ),
    () => (
        <>
            Double-click a table to keep its tab open; a single click previews
            it.
        </>
    ),
];

type TipsState = { index: number; hidden: boolean };

function readState(): TipsState {
    try {
        const raw: unknown = JSON.parse(
            safeStorage.getItem(TIPS_STORAGE_KEY) ?? 'null',
        );
        const { index, hidden } = (raw ?? {}) as Partial<
            Record<keyof TipsState, unknown>
        >;
        return {
            index:
                Number.isInteger(index) &&
                (index as number) >= 0 &&
                (index as number) < TIPS.length
                    ? (index as number)
                    : 0,
            hidden: hidden === true,
        };
    } catch {
        return { index: 0, hidden: false };
    }
}

/** Rotating keyboard tips at the foot of the sidebar; × hides them for good (remembered in localStorage). */
export function TipsCard() {
    const expanded = useSidebarExpanded();
    const [state, setState] = useState(readState);

    const update = (next: TipsState) => {
        setState(next);
        safeStorage.setItem(TIPS_STORAGE_KEY, JSON.stringify(next));
    };
    const go = (index: number) =>
        update({ ...state, index: (index + TIPS.length) % TIPS.length });

    if (!expanded || state.hidden) return null;

    return (
        <section
            aria-label="Tip"
            className="relative mx-1 mb-1 rounded-xl border border-sidebar-border bg-background p-3 text-xs shadow-[var(--panel-shadow)] group-data-[collapsible=icon]:hidden"
        >
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
                <Lightbulb aria-hidden className="size-3.5 text-warning" />
                Tip
            </div>
            <p
                data-testid="tip-text"
                aria-live="polite"
                className="leading-relaxed text-muted-foreground"
            >
                {TIPS[state.index]()}
            </p>
            <div className="mt-2 flex items-center gap-1">
                <div className="flex flex-1 items-center">
                    {TIPS.map((_, i) => (
                        <button
                            key={i}
                            type="button"
                            aria-label={`Tip ${i + 1} of ${TIPS.length}`}
                            aria-current={
                                i === state.index ? 'true' : undefined
                            }
                            onClick={() => go(i)}
                            className="flex h-4 items-center rounded-sm px-0.5 ring-sidebar-ring outline-hidden focus-visible:ring-2"
                        >
                            <span
                                aria-hidden
                                className={cn(
                                    'block h-[5px] rounded-full transition-[width,background-color]',
                                    i === state.index
                                        ? 'w-3 bg-muted-foreground'
                                        : 'w-[5px] bg-border',
                                )}
                            />
                        </button>
                    ))}
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    aria-label="Previous tip"
                    onClick={() => go(state.index - 1)}
                >
                    <ChevronLeft className="size-3.5" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    aria-label="Next tip"
                    onClick={() => go(state.index + 1)}
                >
                    <ChevronRight className="size-3.5" />
                </Button>
            </div>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 size-[22px]"
                aria-label="Hide tips"
                title="Hide tips"
                onClick={() => update({ ...state, hidden: true })}
            >
                <X className="size-3.5" />
            </Button>
        </section>
    );
}
