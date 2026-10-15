import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebounced } from './use-debounced';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useDebounced', () => {
    it('calls once with the latest value after the delay', () => {
        const fn = vi.fn();
        const { result } = renderHook(() => useDebounced(fn, 800));
        act(() => {
            result.current(1);
            result.current(2);
        });
        expect(fn).not.toHaveBeenCalled();
        act(() => void vi.advanceTimersByTime(800));
        expect(fn).toHaveBeenCalledExactlyOnceWith(2);
    });
});
