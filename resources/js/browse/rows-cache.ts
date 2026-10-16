import type {
    PerPage,
    RowFilter,
    RowsResponse,
    SortKey,
} from '@/lib/workspace-api';
import type { Total } from './counts';

export type CacheEntry = {
    /** The request the rows answer; a tab whose filters/sort/page changed refetches. */
    requestKey: string;
    rows: RowsResponse;
    /** null with `countFailed` unset means not counted yet (e.g. the count was interrupted). */
    total: Total;
    /** The count failed for a reason other than its cap; the footer says "count unavailable". */
    countFailed?: boolean;
    scrollTop: number;
};

/** The cache key of the rows request a tab's state asks for. */
export const rowsRequestKey = (state: {
    filters: RowFilter[];
    sort: SortKey[];
    page: number;
    perPage: PerPage;
}): string =>
    JSON.stringify({
        filters: state.filters,
        sort: state.sort,
        page: state.page,
        perPage: state.perPage,
    });

/** Only the most recently used tabs keep their rows in memory; older ones refetch when shown again. */
export const ROWS_CACHE_SIZE = 8;

const entries = new Map<string, CacheEntry>();

export const rowsCache = {
    get(key: string): CacheEntry | undefined {
        const found = entries.get(key);
        if (found) {
            entries.delete(key);
            entries.set(key, found);
        }
        return found;
    },
    set(key: string, entry: CacheEntry): void {
        entries.delete(key);
        entries.set(key, entry);
        while (entries.size > ROWS_CACHE_SIZE)
            entries.delete(entries.keys().next().value as string);
    },
    patch(key: string, part: Partial<CacheEntry>): void {
        const found = entries.get(key);
        if (found) entries.set(key, { ...found, ...part });
    },
    delete(key: string): void {
        entries.delete(key);
    },
    clear(): void {
        entries.clear();
    },
};
