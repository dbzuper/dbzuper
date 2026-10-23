import { useId, useState } from 'react';
import { type DateRange, DayPicker } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import {
    type DateKind,
    isDateOnly,
    LAST_DAY,
    normalizeDateInput,
    quickRanges,
    rangeInOrder,
    TOO_LATE_ERROR,
} from '@/lib/date-filter';
import { cn } from '@/lib/utils';

type Props = {
    kind: DateKind;
    mode: 'single' | 'range';
    value: string;
    to?: string;
    /** False hides the time field even on a datetime column (`on` always means a whole day). */
    allowTime?: boolean;
    /** The filter compares a date-only value (a range's end) against the day after (`on`, `after`, `between`), so 9999-12-31 can't be used. */
    needsNextDay?: boolean;
    onApply: (value: string, to?: string) => void;
    onQuickRange: (from: string, to: string) => void;
    onCancel: () => void;
};

type End = { date: string; time: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** A calendar day (local) as `YYYY-MM-DD`. */
const isoDay = (d: Date) =>
    `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A canonical value's date part as a local calendar day. */
function calendarDay(value: string): Date {
    const d = new Date(
        Number(value.slice(0, 4)),
        Number(value.slice(5, 7)) - 1,
        Number(value.slice(8, 10)),
    );
    d.setFullYear(Number(value.slice(0, 4)));
    return d;
}

/** Splits a value into the date and time fields; a fractional time stays in the date field, as typed. */
function split(value: string | undefined, withTime: boolean): End {
    if (!value) return { date: '', time: '' };
    if (!withTime || value.length <= 10 || value.includes('.')) {
        return { date: value, time: '' };
    }
    return { date: value.slice(0, 10), time: value.slice(11) };
}

type Parsed = { value: string } | { error: string } | { empty: true };

function parse(end: End, kind: DateKind): Parsed {
    const date = end.date.trim();
    if (date === '') return { empty: true };
    return normalizeDateInput(end.time ? `${date} ${end.time}` : date, kind);
}

const valueOf = (p: Parsed) => ('value' in p ? p.value : null);

const ON_TIME_ERROR = '“on” means a whole day — enter a date without a time';
const tooLate: Parsed = { error: TOO_LATE_ERROR };

const fieldClass =
    'h-7 rounded-md border bg-background px-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive';

/** Day buttons are named from their visible number first ("25 October 2026"), as WCAG 2.5.3 asks. */
const calendarLabels = {
    labelDayButton: (
        date: Date,
        modifiers: { today?: boolean; selected?: boolean },
    ) =>
        [
            date.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
            }),
            modifiers.today ? 'today' : null,
            modifiers.selected ? 'selected' : null,
        ]
            .filter(Boolean)
            .join(', '),
};

const calendarClasses = {
    root: 'relative text-xs',
    months: 'flex',
    month: 'flex flex-col gap-2',
    month_caption: 'flex h-7 items-center px-1 font-medium',
    caption_label: 'text-xs',
    nav: 'absolute top-0 right-0 flex items-center gap-1',
    button_previous:
        'inline-flex size-7 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50',
    button_next:
        'inline-flex size-7 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50',
    chevron: 'size-3.5 fill-current',
    month_grid: 'border-collapse',
    weekdays: '',
    weekday: 'size-8 text-[11px] font-normal text-muted-foreground',
    week: '',
    day: 'size-8 p-0 text-center',
    day_button:
        'size-8 rounded-md outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring',
    today: 'font-semibold underline underline-offset-2',
    outside: 'text-muted-foreground',
    disabled: 'opacity-40',
    hidden: 'invisible',
    selected:
        '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary',
    range_start: 'rounded-l-md',
    range_end: 'rounded-r-md',
    range_middle:
        'bg-accent [&>button]:bg-transparent [&>button]:text-foreground [&>button]:hover:bg-primary/20',
};

/** The date filter picker: a calendar, typeable ends, optional times and quick ranges. Loaded lazily. */
export default function DatePicker({
    kind,
    mode,
    value,
    to,
    allowTime = true,
    needsNextDay = false,
    onApply,
    onQuickRange,
    onCancel,
}: Props) {
    const withTime = kind === 'datetime' && allowTime;
    // Without a time field a typed or pasted time is an error too, so `on` always gets a whole day.
    const accepts: DateKind = withTime ? kind : 'date';
    const range = mode === 'range';
    const [from, setFrom] = useState<End>(() => split(value, withTime));
    const [until, setUntil] = useState<End>(() => split(to, withTime));
    const parseEnd = (end: End): Parsed => {
        const parsed = parse(end, accepts);
        // Without a time field (`on`), a valid timed value gets the reason rather than the format hint.
        if (!allowTime && 'error' in parsed) {
            const timed = valueOf(parse(end, 'datetime'));
            if (timed !== null && !isDateOnly(timed)) {
                return { error: ON_TIME_ERROR };
            }
        }
        return parsed;
    };
    let fromParsed = parseEnd(from);
    let untilParsed = parseEnd(until);
    if (needsNextDay) {
        const f = valueOf(fromParsed);
        const u = valueOf(untilParsed);
        // The end is the later value once the two are in order: From on its own, or a reversed range.
        const fromIsEnd =
            !range || (f !== null && u !== null && !rangeInOrder(f, u));
        if (fromIsEnd && f === LAST_DAY) fromParsed = tooLate;
        if (!fromIsEnd && u === LAST_DAY) untilParsed = tooLate;
    }
    const fromValue = valueOf(fromParsed);
    const untilValue = valueOf(untilParsed);
    const [month, setMonth] = useState<Date>(() =>
        fromValue ? calendarDay(fromValue) : new Date(),
    );
    const canApply = fromValue !== null && (!range || untilValue !== null);

    const apply = () => {
        if (fromValue === null) return;
        if (!range) {
            onApply(fromValue, undefined);
            return;
        }
        if (untilValue === null) return;
        if (rangeInOrder(fromValue, untilValue)) onApply(fromValue, untilValue);
        else onApply(untilValue, fromValue);
    };

    // Typing a valid date brings its month into view.
    const typeDate = (set: typeof setFrom, end: End, date: string) => {
        set({ ...end, date });
        const typed = valueOf(parseEnd({ ...end, date }));
        if (typed) setMonth(calendarDay(typed));
    };

    const fromDay = fromValue ? calendarDay(fromValue) : undefined;
    const untilDay = untilValue ? calendarDay(untilValue) : undefined;
    const selectedRange: DateRange | undefined =
        fromDay && untilDay && fromDay > untilDay
            ? { from: untilDay, to: fromDay }
            : fromDay
              ? { from: fromDay, to: untilDay }
              : undefined;

    const calendar = range ? (
        <DayPicker
            mode="range"
            weekStartsOn={1}
            showOutsideDays
            month={month}
            onMonthChange={setMonth}
            selected={selectedRange}
            onSelect={(r) => {
                setFrom({ ...from, date: r?.from ? isoDay(r.from) : '' });
                setUntil({ ...until, date: r?.to ? isoDay(r.to) : '' });
            }}
            classNames={calendarClasses}
            labels={calendarLabels}
        />
    ) : (
        <DayPicker
            mode="single"
            required
            weekStartsOn={1}
            showOutsideDays
            month={month}
            onMonthChange={setMonth}
            selected={fromDay}
            onSelect={(d) => setFrom({ ...from, date: isoDay(d) })}
            classNames={calendarClasses}
            labels={calendarLabels}
        />
    );

    const applyOnEnter = (e: React.KeyboardEvent) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (canApply) apply();
    };

    return (
        <div className="flex gap-3">
            <ul
                aria-label="Quick ranges"
                className="flex flex-col gap-0.5 border-r pr-3"
            >
                {quickRanges(new Date()).map((q) => (
                    <li key={q.label}>
                        <button
                            type="button"
                            className="w-full rounded-md px-2 py-1 text-left text-xs whitespace-nowrap hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                            onClick={() => onQuickRange(q.from, q.to)}
                        >
                            {q.label}
                        </button>
                    </li>
                ))}
            </ul>
            <div className="flex flex-col gap-2">
                {calendar}
                <EndField
                    label={range ? 'From' : 'Date'}
                    end={from}
                    parsed={fromParsed}
                    withTime={withTime}
                    onDate={(date) => typeDate(setFrom, from, date)}
                    onTime={(time) => setFrom({ ...from, time })}
                    onKeyDown={applyOnEnter}
                />
                {range && (
                    <EndField
                        label="To"
                        end={until}
                        parsed={untilParsed}
                        withTime={withTime}
                        onDate={(date) => typeDate(setUntil, until, date)}
                        onTime={(time) => setUntil({ ...until, time })}
                        onKeyDown={applyOnEnter}
                    />
                )}
                <div className="flex justify-end gap-1.5">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onCancel}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        disabled={!canApply}
                        onClick={apply}
                    >
                        Apply
                    </Button>
                </div>
            </div>
        </div>
    );
}

function EndField({
    label,
    end,
    parsed,
    withTime,
    onDate,
    onTime,
    onKeyDown,
}: {
    label: string;
    end: End;
    parsed: Parsed;
    withTime: boolean;
    onDate: (date: string) => void;
    onTime: (time: string) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
}) {
    const id = useId();
    const error = 'error' in parsed ? parsed.error : null;
    const timeLabel = label === 'Date' ? 'Time' : `${label} time`;
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
                <label
                    htmlFor={`${id}-date`}
                    className="w-9 text-xs text-muted-foreground"
                >
                    {label}
                </label>
                <input
                    id={`${id}-date`}
                    className={cn(fieldClass, 'w-28 flex-1')}
                    placeholder="YYYY-MM-DD"
                    autoComplete="off"
                    spellCheck={false}
                    value={end.date}
                    aria-invalid={error !== null}
                    aria-describedby={error ? `${id}-error` : undefined}
                    onChange={(e) => onDate(e.target.value)}
                    onKeyDown={onKeyDown}
                />
                {withTime && (
                    <input
                        type="time"
                        step={1}
                        aria-label={timeLabel}
                        className={cn(fieldClass, 'w-24')}
                        value={end.time}
                        onChange={(e) => onTime(e.target.value)}
                        onKeyDown={onKeyDown}
                    />
                )}
            </div>
            {error && (
                <p
                    id={`${id}-error`}
                    role="alert"
                    className="pl-10.5 text-[11px] text-destructive"
                >
                    {error}
                </p>
            )}
        </div>
    );
}
