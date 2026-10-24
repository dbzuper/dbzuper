import { CalendarDays } from 'lucide-react';
import { lazy, Suspense, useRef, useState, type RefObject } from 'react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import type { DateKind } from '@/lib/date-filter';
import { cn } from '@/lib/utils';

/** Alt+ArrowDown in the editor's input opens the picker (the grid's Tab leaves the cell, so it never reaches the button). */
export const OPEN_PICKER_KEYS = 'Alt+ArrowDown';
export const opensPicker = (e: {
    key: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
}) =>
    e.key === 'ArrowDown' &&
    e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey;

// The calendar (react-day-picker) loads with the filter picker's chunk, only when a picker opens.
const EditDatePicker = lazy(() =>
    import('@/components/inspector/date-picker').then((m) => ({
        default: m.EditDatePicker,
    })),
);

/**
 * The calendar button beside a date or datetime editor (grid cell, row drawer field) and its picker. Apply hands
 * the picked value to `onApply`; Cancel, Escape and Apply return focus to the editor's input. The picker's keys
 * stay in the picker, so Escape there never also cancels the cell edit or closes the drawer.
 */
export function DateEditPopover({
    kind,
    value,
    inputRef,
    triggerRef,
    onApply,
    className,
}: {
    kind: DateKind;
    /** The editor's current text (draft or value); empty or unparseable text opens the picker empty. */
    value: string;
    inputRef: RefObject<HTMLInputElement | null>;
    /** Lets the input open the picker from the keyboard (see `opensPicker`). */
    triggerRef?: RefObject<HTMLButtonElement | null>;
    onApply: (value: string) => void;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    // A click elsewhere closes the picker without pulling focus back to the input.
    const leftOutside = useRef(false);
    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (next) leftOutside.current = false;
                setOpen(next);
            }}
        >
            <PopoverTrigger asChild>
                <button
                    ref={triggerRef}
                    type="button"
                    aria-label="Choose date"
                    title="Choose date"
                    className={cn(
                        'inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:outline-none',
                        className,
                    )}
                >
                    <CalendarDays className="size-3.5" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-auto p-3"
                aria-label="Choose a date"
                // Portal content still bubbles through React: keep Enter, Tab and Escape from the grid and drawer.
                onKeyDown={(e) => e.stopPropagation()}
                onInteractOutside={() => {
                    leftOutside.current = true;
                }}
                onCloseAutoFocus={(e) => {
                    e.preventDefault();
                    if (!leftOutside.current) inputRef.current?.focus();
                }}
            >
                <Suspense
                    fallback={<Spinner className="m-4 text-muted-foreground" />}
                >
                    <EditDatePicker
                        kind={kind}
                        value={value}
                        onApply={(picked) => {
                            setOpen(false);
                            onApply(picked);
                        }}
                        onCancel={() => setOpen(false)}
                    />
                </Suspense>
            </PopoverContent>
        </Popover>
    );
}
