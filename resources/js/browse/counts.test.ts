import { describe, expect, it } from 'vitest';
import { initialTotal, lastPage, rangeLabel, totalFromCount } from './counts';

describe('initialTotal', () => {
    it('trusts an exact snapshot count', () => {
        expect(initialTotal({ count: 12, kind: 'exact' }, 'mysql')).toEqual({
            total: { count: 12, exact: true },
            autoCount: false,
        });
    });
    it('shows a large estimate and does not count automatically', () => {
        expect(
            initialTotal({ count: 80_000, kind: 'estimate' }, 'pgsql'),
        ).toEqual({
            total: { count: 80_000, exact: false },
            autoCount: false,
        });
    });
    it('counts small estimates, at-least counts, unknowns and SQLite automatically', () => {
        expect(
            initialTotal({ count: 49_999, kind: 'estimate' }, 'mysql')
                .autoCount,
        ).toBe(true);
        expect(
            initialTotal({ count: 100_000, kind: 'at_least' }, 'sqlite')
                .autoCount,
        ).toBe(true);
        expect(
            initialTotal({ count: null, kind: 'unknown' }, 'mariadb'),
        ).toEqual({ total: null, autoCount: true });
        expect(
            initialTotal({ count: 900_000, kind: 'estimate' }, 'sqlite')
                .autoCount,
        ).toBe(true);
    });
});

describe('totalFromCount', () => {
    it('maps exact and timeout results', () => {
        expect(totalFromCount({ count: 7, kind: 'exact' }, 7)).toEqual({
            count: 7,
            exact: true,
        });
        expect(totalFromCount({ count: null, kind: 'timeout' }, 100)).toEqual({
            atLeast: 100,
        });
    });
});

describe('rangeLabel', () => {
    it('describes the rows on screen', () => {
        expect(rangeLabel(1, 100, 100, { count: 12_430, exact: true })).toBe(
            'Rows 1–100 of 12,430',
        );
        expect(rangeLabel(2, 100, 100, { count: 12_430, exact: false })).toBe(
            'Rows 101–200 of ~12,430',
        );
        expect(rangeLabel(1, 100, 100, { atLeast: 100 })).toBe(
            'Rows 1–100 of 100+',
        );
        expect(rangeLabel(1, 100, 40, null)).toBe('Rows 1–40');
        expect(rangeLabel(1, 100, 0, { count: 0, exact: true })).toBe(
            'No rows',
        );
    });
});

describe('lastPage', () => {
    it('is only known for exact totals', () => {
        expect(lastPage({ count: 250, exact: true }, 100)).toBe(3);
        expect(lastPage({ count: 0, exact: true }, 100)).toBe(1);
        expect(lastPage({ count: 250, exact: false }, 100)).toBeNull();
        expect(lastPage({ atLeast: 100 }, 100)).toBeNull();
        expect(lastPage(null, 100)).toBeNull();
    });
});
