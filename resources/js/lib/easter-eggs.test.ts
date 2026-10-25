import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    claimSevenWish,
    isOverNineThousand,
    makeAWish,
    matchesWish,
    onWish,
} from '@/lib/easter-eggs';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('isOverNineThousand', () => {
    it('is true only above 9,000 rows, for any kind of count', () => {
        expect(isOverNineThousand({ count: 9000, kind: 'exact' })).toBe(false);
        expect(isOverNineThousand({ count: 9001, kind: 'exact' })).toBe(true);
        expect(isOverNineThousand({ count: 12000, kind: 'estimate' })).toBe(
            true,
        );
        expect(isOverNineThousand({ count: 10000, kind: 'at_least' })).toBe(
            true,
        );
    });

    it('is false when the count is unknown', () => {
        expect(isOverNineThousand({ count: null, kind: 'unknown' })).toBe(
            false,
        );
    });
});

describe('matchesWish', () => {
    it('matches the whole phrase, ignoring case and extra spaces', () => {
        expect(matchesWish('make a wish')).toBe(true);
        expect(matchesWish('  Make  A Wish ')).toBe(true);
        expect(matchesWish('make a')).toBe(false);
        expect(matchesWish('make a wish now')).toBe(false);
    });
});

describe('claimSevenWish', () => {
    it('is true once per browser', () => {
        expect(claimSevenWish()).toBe(true);
        expect(claimSevenWish()).toBe(false);
    });

    it('is false when storage is unavailable, so the toast never repeats', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });

        expect(claimSevenWish()).toBe(false);
    });
});

describe('makeAWish', () => {
    it('tells the listeners, until they stop listening', () => {
        const listener = vi.fn();
        const stop = onWish(listener);

        makeAWish();
        stop();
        makeAWish();

        expect(listener).toHaveBeenCalledOnce();
    });
});
