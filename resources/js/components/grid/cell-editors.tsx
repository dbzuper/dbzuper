import { useState, type KeyboardEvent } from 'react';

/** Column type tests for editing (type names as the snapshot reports them). */
export const isBooleanType = (type: string | null) =>
    /^bool(ean)?$/i.test((type ?? '').trim());
export const isJsonType = (type: string | null) => /json/i.test(type ?? '');
export const isBinaryType = (type: string | null) =>
    /blob|binary|bytea|varbinary|image/i.test(type ?? '');

/** Why a JSON value can't be staged, or null when it parses. */
export function jsonError(text: string): string | null {
    try {
        JSON.parse(text);
        return null;
    } catch (e) {
        return `Invalid JSON: ${e instanceof Error ? e.message : 'it does not parse'}`;
    }
}

type EditorProps = {
    label: string;
    /** The text shown when the editor opens. */
    initial: string;
    /** The draft as typed so far (undefined until the first change). */
    draft: string | undefined;
    onDraft: (value: string) => void;
    json: boolean;
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
}: EditorProps) {
    const [error, setError] = useState<string | null>(null);
    const value = draft ?? initial;
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
                // The grid opens the editor for this cell on purpose; focus belongs in it.
                autoFocus
                aria-label={label}
                aria-invalid={error ? true : undefined}
                className="h-full w-full bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--universe-accent)] focus-visible:ring-inset aria-invalid:ring-2 aria-invalid:ring-destructive"
                value={value}
                onChange={(e) => {
                    setError(null);
                    onDraft(e.target.value);
                }}
                onKeyDown={onKeyDown}
                onFocus={(e) => e.target.select()}
            />
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
