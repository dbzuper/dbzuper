import { describe, expect, it, vi } from 'vitest';
import { retryable } from './retry-once';

describe('retryable', () => {
    it('shares one successful load', async () => {
        const loader = vi.fn(() => Promise.resolve(7));
        const load = retryable(loader);
        expect(await Promise.all([load(), load()])).toEqual([7, 7]);
        expect(await load()).toBe(7);
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it('does not cache a rejection', async () => {
        const loader = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new Error('chunk failed'))
            .mockResolvedValue('ok');
        const load = retryable(loader);
        await expect(load()).rejects.toThrow('chunk failed');
        expect(await load()).toBe('ok');
        expect(loader).toHaveBeenCalledTimes(2);
    });
});
