import { beforeEach, describe, expect, it } from 'vitest';
import type { RowsResponse } from '@/lib/workspace-api';
import { ROWS_CACHE_SIZE, rowsCache } from './rows-cache';

const rows = {} as RowsResponse;
const entry = (requestKey: string) => ({
    requestKey,
    rows,
    total: null,
    scrollTop: 0,
});

describe('rowsCache', () => {
    beforeEach(() => rowsCache.clear());

    it('keeps the most recently used entries only', () => {
        for (let i = 0; i < ROWS_CACHE_SIZE + 2; i++)
            rowsCache.set(`t${i}`, entry(`r${i}`));
        expect(rowsCache.get('t0')).toBeUndefined();
        expect(rowsCache.get('t1')).toBeUndefined();
        expect(rowsCache.get(`t${ROWS_CACHE_SIZE + 1}`)?.requestKey).toBe(
            `r${ROWS_CACHE_SIZE + 1}`,
        );
    });

    it('refreshes recency on get and merges patches', () => {
        for (let i = 0; i < ROWS_CACHE_SIZE; i++)
            rowsCache.set(`t${i}`, entry(`r${i}`));
        rowsCache.get('t0');
        rowsCache.set('new', entry('n'));
        expect(rowsCache.get('t0')).toBeDefined();
        expect(rowsCache.get('t1')).toBeUndefined();
        rowsCache.patch('t0', { scrollTop: 420 });
        expect(rowsCache.get('t0')?.scrollTop).toBe(420);
        rowsCache.patch('missing', { scrollTop: 1 });
        expect(rowsCache.get('missing')).toBeUndefined();
    });
});
