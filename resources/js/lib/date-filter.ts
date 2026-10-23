import { FILTER_OPS, type FilterOp } from './workspace-api';

/** Which date operators a column takes: a calendar date, or a date with a time of day. */
export type DateKind = 'date' | 'datetime';

/** The operators offered for a date column, in display order. */
export const DATE_OPS: FilterOp[] = [
    'on',
    'between',
    'lt',
    'after',
    'eq',
    'neq',
    'is_null',
    'is_not_null',
];

const FORMAT_ERROR = 'Use YYYY-MM-DD or YYYY-MM-DD HH:MM:SS';
const ZONE_ERROR = 'Time zones aren’t supported; enter the time as stored';

const TYPED =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/;
const ZONED =
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
];

/** Mirrors the server's DateKind::classify: `date` exactly, or any type naming datetime/timestamp. */
export function dateKind(column: { type_name: string }): DateKind | null {
    const t = column.type_name.trim().toLowerCase();
    if (t === 'date') {
        return 'date';
    }
    return t.includes('datetime') || t.includes('timestamp')
        ? 'datetime'
        : null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A UTC midnight for a calendar date (years below 100 included), so there is no DST drift. */
function utcDay(year: number, month: number, day: number): Date {
    const d = new Date(0);
    d.setUTCFullYear(year, month - 1, day);
    return d;
}

function isoDay(d: Date): string {
    return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Turns typed text into the canonical form the server accepts, or says why it can't. */
export function normalizeDateInput(
    text: string,
    kind: DateKind,
): { value: string } | { error: string } {
    const trimmed = text.trim();
    if (ZONED.test(trimmed)) {
        return { error: ZONE_ERROR };
    }
    const m = TYPED.exec(trimmed);
    if (!m) {
        return { error: FORMAT_ERROR };
    }
    const [, y, mo, d, hh, mi, ss, frac] = m;
    const timed = hh !== undefined;
    if (timed && kind === 'date') {
        return { error: FORMAT_ERROR };
    }
    const day = utcDay(Number(y), Number(mo), Number(d));
    if (isoDay(day) !== `${y}-${mo}-${d}`) {
        return { error: FORMAT_ERROR };
    }
    if (!timed) {
        return { value: `${y}-${mo}-${d}` };
    }
    if (Number(hh) > 23 || Number(mi) > 59 || Number(ss ?? '0') > 59) {
        return { error: FORMAT_ERROR };
    }
    return {
        value: `${y}-${mo}-${d} ${hh}:${mi}:${ss ?? '00'}${frac === undefined ? '' : `.${frac}`}`,
    };
}

export function isDateOnly(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Calendar-day arithmetic on the date part of a canonical value; returns a date-only value. */
export function addDays(date: string, days: number): string {
    const day = utcDay(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)),
        Number(date.slice(8, 10)),
    );
    day.setUTCDate(day.getUTCDate() + days);
    return isoDay(day);
}

/** `2026-10-01` -> `1 Oct 2026`; a time follows as HH:MM, with seconds (and fraction) only when present. */
export function formatDateValue(value: string): string {
    const day = `${Number(value.slice(8, 10))} ${MONTHS[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}`;
    if (value.length <= 10) {
        return day;
    }
    const time = value.slice(11);
    const [hms, frac] = time.split('.');
    const seconds = hms.slice(6, 8);
    return `${day} ${seconds === '00' && frac === undefined ? hms.slice(0, 5) : time}`;
}

/** Date-only ranges from the local calendar date of `today`. */
export function quickRanges(
    today: Date,
): { label: string; from: string; to: string }[] {
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    const t = `${pad(y, 4)}-${pad(m)}-${pad(today.getDate())}`;
    const firstOfMonth = `${pad(y, 4)}-${pad(m)}-01`;
    const nextMonth = isoDay(
        utcDay(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1),
    );
    const lastMonthEnd = addDays(firstOfMonth, -1);
    return [
        { label: 'Today', from: t, to: t },
        { label: 'Yesterday', from: addDays(t, -1), to: addDays(t, -1) },
        { label: 'Last 7 days', from: addDays(t, -6), to: t },
        { label: 'Last 30 days', from: addDays(t, -29), to: t },
        { label: 'This month', from: firstOfMonth, to: addDays(nextMonth, -1) },
        {
            label: 'Last month',
            from: `${lastMonthEnd.slice(0, 8)}01`,
            to: lastMonthEnd,
        },
    ];
}

/** `lt` reads as "before" on a date column; every other operator keeps its filter label. */
export function dateOpLabel(op: FilterOp, kind: DateKind | null): string {
    if (op === 'lt' && kind !== null) {
        return 'before';
    }
    return FILTER_OPS.find((o) => o.value === op)?.label ?? op;
}

/** A fixed-width string that compares in time order: date-only reads as 00:00, fraction padded to six digits. */
function instant(value: string): string {
    const [seconds, fraction = ''] = value.split('.');
    return `${isDateOnly(seconds) ? `${seconds} 00:00:00` : seconds}.${fraction.padEnd(6, '0')}`;
}

/**
 * Whether a range of canonical values selects anything (mirrors the server): a date-only end means its whole day
 * (start < end + 1 day), a timed end is inclusive (start <= end).
 */
export function rangeInOrder(from: string, to: string): boolean {
    return isDateOnly(to)
        ? instant(from) < instant(addDays(to, 1))
        : instant(from) <= instant(to);
}
