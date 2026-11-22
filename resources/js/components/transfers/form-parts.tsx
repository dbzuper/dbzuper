import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { ToolCheck, TransferMethod } from '@/lib/transfers-api';
import { cn } from '@/lib/utils';

export const radioClass =
    'size-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-50';

/**
 * One labelled row of a transfer form: the label column, then its controls. With `htmlFor` the label names that one
 * control instead of the row.
 */
export function Row({
    label,
    htmlFor,
    children,
}: {
    label: string;
    htmlFor?: string;
    children: ReactNode;
}) {
    const id = useId();
    const labelClass = 'pt-px text-sm text-muted-foreground';
    return (
        <div
            role={htmlFor ? undefined : 'group'}
            aria-labelledby={htmlFor ? undefined : id}
            className="grid grid-cols-[5.5rem_1fr] items-start gap-x-3 gap-y-2"
        >
            {htmlFor ? (
                <label htmlFor={htmlFor} className={labelClass}>
                    {label}
                </label>
            ) : (
                <span id={id} className={labelClass}>
                    {label}
                </span>
            )}
            <div className="grid min-w-0 gap-2">{children}</div>
        </div>
    );
}

/**
 * The method a backup or restore uses, after the server's choice. Without a usable native tool it says why and
 * stays on built-in; "Change" opens the choice between the two.
 */
export function useMethod(
    native: ToolCheck | null,
    defaultMethod: TransferMethod | null,
) {
    /** The user's choice; null keeps the server's default. */
    const [method, setMethod] = useState<TransferMethod | null>(null);
    const effective: TransferMethod | null =
        native === null || defaultMethod === null
            ? null
            : native.usable
              ? (method ?? defaultMethod)
              : 'builtin';
    const line =
        effective === null || native === null
            ? 'Checking…'
            : effective === 'native'
              ? `Native — ${native.reason}`
              : native.usable
                ? 'Built-in'
                : native.reason;
    /** What to send: a native choice made before native turned out unusable falls back. */
    const requested: TransferMethod | null =
        method === 'native' && !native?.usable ? 'builtin' : method;

    return { method, setMethod, effective, line, requested };
}

/**
 * The method line with its Change button and, when open, the native / built-in choice. Just the line when the engine
 * has no native tool.
 */
export function MethodChoice({
    native,
    effective,
    line,
    onChoose,
}: {
    native: ToolCheck | null;
    effective: TransferMethod | null;
    line: string;
    onChoose: (method: TransferMethod) => void;
}) {
    const [open, setOpen] = useState(false);
    const name = useId();
    // No native tool exists for this engine (SQLite): built-in is the only method, nothing to change.
    const onlyBuiltin = native !== null && native.tool === null;

    if (onlyBuiltin) {
        return <span className="min-w-0 text-sm">{line}</span>;
    }

    return (
        <>
            <div className="flex min-w-0 items-start gap-2">
                <span className="min-w-0 flex-1 text-sm">{line}</span>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-2 text-xs"
                    aria-label="Change method"
                    aria-expanded={open}
                    disabled={native === null}
                    onClick={() => setOpen((o) => !o)}
                >
                    Change
                </Button>
            </div>
            {open && native && (
                <div
                    role="radiogroup"
                    aria-label="Method"
                    className="grid gap-1 rounded-md border p-2"
                >
                    <label
                        className={cn(
                            'inline-flex items-start gap-2 text-sm',
                            !native.usable && 'text-muted-foreground',
                        )}
                    >
                        <input
                            type="radio"
                            name={name}
                            className={cn(radioClass, 'mt-0.5')}
                            checked={effective === 'native'}
                            disabled={!native.usable}
                            onChange={() => onChoose('native')}
                        />
                        <span>
                            Native
                            {native.reason && (
                                <span className="text-muted-foreground">
                                    {' '}
                                    — {native.reason}
                                </span>
                            )}
                        </span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm">
                        <input
                            type="radio"
                            name={name}
                            className={radioClass}
                            checked={effective === 'builtin'}
                            onChange={() => onChoose('builtin')}
                        />
                        Built-in
                    </label>
                </div>
            )}
        </>
    );
}
