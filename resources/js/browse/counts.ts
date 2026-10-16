import type { CountResponse } from '@/lib/workspace-api';
import type { RowCountSchema } from '@/types/schema';

/** What the footer knows about a table's size: a count (exact or estimated), a lower bound, or nothing. */
export type Total =
    | { count: number; exact: boolean }
    | { atLeast: number }
    | null;

/** Estimates below this are cheap enough to count for real as soon as the tab opens. */
const AUTO_COUNT_BELOW = 50_000;

export function initialTotal(
    rc: RowCountSchema,
    driver: string,
): { total: Total; autoCount: boolean } {
    if (rc.kind === 'exact' && rc.count !== null)
        return { total: { count: rc.count, exact: true }, autoCount: false };
    const total: Total =
        rc.count === null || rc.kind === 'unknown'
            ? null
            : rc.kind === 'at_least'
              ? { atLeast: rc.count }
              : { count: rc.count, exact: false };
    const autoCount =
        driver === 'sqlite' ||
        rc.kind !== 'estimate' ||
        rc.count === null ||
        rc.count < AUTO_COUNT_BELOW;
    return { total, autoCount };
}

export function totalFromCount(res: CountResponse, rowsSeen: number): Total {
    return res.kind === 'exact' && res.count !== null
        ? { count: res.count, exact: true }
        : { atLeast: rowsSeen };
}

const full = new Intl.NumberFormat('en');

export function rangeLabel(
    page: number,
    perPage: number,
    rowsOnPage: number,
    total: Total,
): string {
    if (rowsOnPage === 0) return 'No rows';
    const from = (page - 1) * perPage + 1;
    const range = `Rows ${full.format(from)}–${full.format(from + rowsOnPage - 1)}`;
    if (!total) return range;
    if ('atLeast' in total) return `${range} of ${full.format(total.atLeast)}+`;
    return `${range} of ${total.exact ? '' : '~'}${full.format(total.count)}`;
}

export function lastPage(total: Total, perPage: number): number | null {
    if (!total || 'atLeast' in total || !total.exact) return null;
    return Math.max(1, Math.ceil(total.count / perPage));
}
