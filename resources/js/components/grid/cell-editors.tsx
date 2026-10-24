import { useRef, useState, type KeyboardEvent } from 'react';

import {
    DateEditPopover,
    OPEN_PICKER_KEYS,
    opensPicker,
} from '@/components/editing/date-edit-popover';
import { jsonError } from '@/editing/row-edit';
import type { DateKind } from '@/lib/date-filter';
import { cn } from '@/lib/utils';

// The editing rules live with the pending store, shared with the row drawer.
export {
    isBinaryType,
    isBooleanType,
    isJsonType,
    jsonError,
} from '@/editing/row-edit';

type EditorProps = {
    label: string;
    /** The text shown when the editor opens. */
    initial: string;
    /** The draft as typed so far (undefined until the first change). */
    draft: string | undefined;
    onDraft: (value: string) => void;
    json: boolean;
    /** A date or datetime column gets a calendar button; Apply hands the picked value to `onPick`. */
    date?: { kind: DateKind; onPick: (value: string) => void } | null;
};

/**
 * The inline text editor. Enter and Tab keep the value (react-data-grid commits), Escape cancels. Invalid JSON for
 * a JSON column stops Enter and Tab and says why, so it is never staged.
 */
export function TextCellEditor({
    label,
    initial,
    draft,
    onDraft,
    json,
    date,
}: EditorProps) {
    const [error, setError] = useState<string | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const value = draft ?? initial;
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (date && opensPicker(event)) {
            event.preventDefault();
            event.stopPropagation();
            trigger.current?.click();
            return;
        }
        if (!json || (event.key !== 'Enter' && event.key !== 'Tab')) return;
        const problem = draft === undefined ? null : jsonError(draft);
        setError(problem);
        if (problem) {
            event.preventDefault();
            event.stopPropagation();
        }
    };
    return (
        <span className="relative block h-full">
            <input
                ref={input}
                // The grid opens the editor for this cell on purpose; focus belongs in it.
                autoFocus
                aria-label={label}
                aria-invalid={error ? true : undefined}
                aria-keyshortcuts={date ? OPEN_PICKER_KEYS : undefined}
                className={cn(
                    'h-full w-full bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:ring-inset aria-invalid:ring-2 aria-invalid:ring-destructive',
                    date && 'pr-7',
                )}
                value={value}
                onChange={(e) => {
                    setError(null);
                    onDraft(e.target.value);
                }}
                onKeyDown={onKeyDown}
                onFocus={(e) => e.target.select()}
            />
            {date && (
                <DateEditPopover
                    kind={date.kind}
                    value={value}
                    inputRef={input}
                    triggerRef={trigger}
                    onApply={date.onPick}
                    className="absolute top-1/2 right-0.5 -translate-y-1/2"
                />
            )}
            {error && (
                <span
                    role="alert"
                    className="absolute top-full left-0 z-10 mt-0.5 max-w-80 rounded border bg-popover px-2 py-1 text-[11px] whitespace-normal text-destructive shadow"
                >
                    {error}
                </span>
            )}
        </span>
    );
}

/** A checkbox for boolean columns; Space toggles, Enter keeps, Escape cancels. */
export function BoolCellEditor({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <span className="flex h-full items-center px-2">
            <input
                autoFocus
                type="checkbox"
                aria-label={label}
                className="size-3.5 accent-[var(--universe-accent)]"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
            />
        </span>
    );
}
