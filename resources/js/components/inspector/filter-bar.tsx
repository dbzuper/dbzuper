import { CalendarDays, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import {
    DATE_OPS,
    type DateKind,
    dateOpLabel,
    filterChipText,
    formatDateValue,
    isDateOnly,
    isDateOp,
    normalizeDateInput,
} from '@/lib/date-filter';
import { FILTER_OPS, type FilterOp, type RowFilter } from '@/lib/workspace-api';

export { filterChipText };

// The calendar (react-day-picker and date-fns) loads the first time a picker opens.
const DatePicker = lazy(() => import('./date-picker'));

/** The operators offered for a column of this kind: the date ones, or the plain list without them. */
const opsFor = (kind: DateKind | null): FilterOp[] =>
    kind
        ? DATE_OPS
        : FILTER_OPS.map((o) => o.value).filter((op) => !isDateOp(op));

const needsValueOf = (op: FilterOp) =>
    FILTER_OPS.find((o) => o.value === op)?.needsValue ?? false;

/** The filter a picked value makes; a date-only range of one day is that whole day, i.e. `on`. */
function pickedFilter(
    column: string,
    op: FilterOp,
    value: string,
    to?: string,
): RowFilter {
    if (op !== 'between' || to === undefined) return { column, op, value };
    if (value === to && isDateOnly(value)) return { column, op: 'on', value };
    return { column, op, value, to };
}

const fieldClass =
    'h-7 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring';

type Props = {
    columns: string[];
    filters: RowFilter[];
    onChange: (filters: RowFilter[]) => void;
    /** Id of the first control (the column select), for focusing the bar from elsewhere. */
    id?: string;
    /** A header filter click: switches to this column with `contains` and focuses the value input. */
    draft?: { column: string; nonce: number } | null;
    /** Column name -> date kind, for the columns that take the date operators and the picker. */
    dateKinds?: Record<string, DateKind>;
};

export function FilterBar({
    columns,
    filters,
    onChange,
    id,
    draft,
    dateKinds,
}: Props) {
    const [column, setColumn] = useState('');
    // null means the default for the column's kind: `on` for a date column, `equals` otherwise.
    const [chosenOp, setOp] = useState<FilterOp | null>(null);
    const [value, setValue] = useState('');
    const [to, setTo] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);

    const selected = columns.includes(column) ? column : (columns[0] ?? '');
    const kindOf = (c: string) => dateKinds?.[c] ?? null;
    const kind = kindOf(selected);
    const ops = opsFor(kind);
    // An operator the column's kind does not offer falls back to that kind's default.
    const op: FilterOp =
        chosenOp !== null && ops.includes(chosenOp)
            ? chosenOp
            : kind
              ? 'on'
              : 'eq';
    const needsValue = needsValueOf(op);
    // On a date column only a canonical value counts (date-only for `on`), so the bar never sends one unchecked.
    const isValue = (v: string) =>
        v !== '' &&
        (kind === null ||
            'value' in normalizeDateInput(v, op === 'on' ? 'date' : kind));
    const hasValue = isValue(value) && (op !== 'between' || isValue(to));
    // What the date button shows; it is also part of the button's name (WCAG 2.5.3, label in name).
    const valueText = hasValue
        ? `${formatDateValue(value)}${op === 'between' && to ? ` → ${formatDateValue(to)}` : ''}`
        : 'Pick a date…';
    const canAdd = selected !== '' && (!needsValue || hasValue);

    const changeColumn = (next: string) => {
        const nextKind = kindOf(next);
        if (nextKind !== kind) {
            // Keep an operator the user chose when the new kind offers it; a value typed for one kind means nothing to another.
            setOp(
                chosenOp !== null && opsFor(nextKind).includes(chosenOp)
                    ? chosenOp
                    : null,
            );
            setValue('');
            setTo('');
        }
        setColumn(next);
    };

    const columnSelect = useRef<HTMLSelectElement>(null);
    // The text input, or the picker button on a date column.
    const valueInput = useRef<HTMLInputElement & HTMLButtonElement>(null);
    const focusValue = useRef(false);
    const draftColumn = draft?.column;
    const draftNonce = draft?.nonce;
    useEffect(() => {
        if (draftColumn === undefined) return;
        setColumn(draftColumn);
        // A date column has no `contains`, so it shows its default operator instead.
        setOp('contains');
        // A new filter on that column: text typed for another column (perhaps of another kind) is dropped.
        setValue('');
        setTo('');
        focusValue.current = true;
    }, [draftColumn, draftNonce]);
    // The value input may only appear once the operator has switched, so focus waits for that render.
    useEffect(() => {
        if (!focusValue.current || !valueInput.current) return;
        focusValue.current = false;
        valueInput.current.focus();
    });
    const removeButtons = useRef<(HTMLButtonElement | null)[]>([]);
    // After a chip is removed focus goes to its neighbour (or the column select), never to <body>.
    const focusAfterRemoval = useRef<{
        index: number;
        count: number;
    } | null>(null);
    useEffect(() => {
        const pending = focusAfterRemoval.current;
        focusAfterRemoval.current = null;
        // Only a removal moves focus; any other change to the filters leaves it alone.
        if (pending === null || filters.length >= pending.count) return;
        const index = pending.index;
        const next = removeButtons.current[Math.min(index, filters.length - 1)];
        (filters.length > 0 ? next : columnSelect.current)?.focus();
    }, [filters]);

    const add = () => {
        if (!canAdd) return;
        onChange([
            ...filters,
            needsValue
                ? pickedFilter(
                      selected,
                      op,
                      value,
                      op === 'between' ? to : undefined,
                  )
                : { column: selected, op },
        ]);
        setValue('');
        setTo('');
    };

    // The picker's Apply and quick ranges add the filter at once; the operator select shows the one actually added.
    const addPicked = (nextOp: FilterOp, from: string, until?: string) => {
        const picked = pickedFilter(selected, nextOp, from, until);
        setPickerOpen(false);
        setOp(picked.op);
        setValue('');
        setTo('');
        onChange([...filters, picked]);
    };

    // Enter in a select adds the filter once nothing more needs typing.
    const addOnEnter = (e: React.KeyboardEvent) => {
        if (e.key !== 'Enter' || needsValue) return;
        e.preventDefault();
        add();
    };

    return (
        <div className="flex flex-col gap-2 border-b px-4 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
                <select
                    ref={columnSelect}
                    id={id}
                    aria-label="Filter column"
                    className={fieldClass}
                    value={selected}
                    onChange={(e) => changeColumn(e.target.value)}
                    onKeyDown={addOnEnter}
                >
                    {columns.map((c) => (
                        <option key={c} value={c}>
                            {c}
                        </option>
                    ))}
                </select>
                <select
                    aria-label="Filter operator"
                    className={fieldClass}
                    value={op}
                    onChange={(e) => setOp(e.target.value as FilterOp)}
                    onKeyDown={addOnEnter}
                >
                    {ops.map((o) => (
                        <option key={o} value={o}>
                            {dateOpLabel(o, kind)}
                        </option>
                    ))}
                </select>
                {needsValue && kind && (
                    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                        <PopoverTrigger asChild>
                            <button
                                ref={valueInput}
                                type="button"
                                aria-label={`Filter value: ${valueText}`}
                                aria-haspopup="dialog"
                                className={`${fieldClass} inline-flex min-w-36 items-center gap-1.5 text-left`}
                            >
                                <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
                                <span
                                    className={
                                        hasValue
                                            ? undefined
                                            : 'text-muted-foreground'
                                    }
                                >
                                    {valueText}
                                </span>
                            </button>
                        </PopoverTrigger>
                        <PopoverContent
                            align="start"
                            className="w-auto p-3"
                            aria-label="Choose a date"
                        >
                            <Suspense
                                fallback={
                                    <Spinner className="m-4 text-muted-foreground" />
                                }
                            >
                                <DatePicker
                                    kind={kind}
                                    mode={op === 'between' ? 'range' : 'single'}
                                    value={value}
                                    to={op === 'between' ? to : undefined}
                                    allowTime={op !== 'on'}
                                    needsNextDay={isDateOp(op)}
                                    onApply={(from, until) =>
                                        addPicked(op, from, until)
                                    }
                                    onQuickRange={(from, until) =>
                                        addPicked('between', from, until)
                                    }
                                    onCancel={() => setPickerOpen(false)}
                                />
                            </Suspense>
                        </PopoverContent>
                    </Popover>
                )}
                {needsValue && !kind && (
                    <input
                        ref={valueInput}
                        aria-label="Filter value"
                        className={`${fieldClass} w-36`}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                add();
                            }
                        }}
                    />
                )}
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canAdd}
                    onClick={add}
                >
                    Add filter
                </Button>
            </div>
            {filters.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                    {filters.map((f, i) => {
                        const text = filterChipText(f, kindOf(f.column));
                        return (
                            <li
                                key={`${f.column}:${f.op}:${f.value ?? ''}:${f.to ?? ''}:${i}`}
                                className="flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 font-mono text-[11px]"
                            >
                                <span>{text}</span>
                                <button
                                    type="button"
                                    ref={(el) => {
                                        removeButtons.current[i] = el;
                                    }}
                                    aria-label={`Remove filter ${text}`}
                                    className="rounded-full text-muted-foreground hover:text-foreground"
                                    onClick={() => {
                                        focusAfterRemoval.current = {
                                            index: i,
                                            count: filters.length,
                                        };
                                        onChange(
                                            filters.filter((_, j) => j !== i),
                                        );
                                    }}
                                >
                                    <X className="size-3" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
