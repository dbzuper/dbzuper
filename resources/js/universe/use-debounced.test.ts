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
            result.current.call(1);
            result.current.call(2);
        });
        expect(fn).not.toHaveBeenCalled();
        act(() => void vi.advanceTimersByTime(800));
        expect(fn).toHaveBeenCalledExactlyOnceWith(2);
    });

    it('flush runs the pending call immediately, once', () => {
        const fn = vi.fn();
        const { result } = renderHook(() => useDebounced(fn, 800));
        act(() => result.current.call(1));
        act(() => result.current.flush());
        expect(fn).toHaveBeenCalledExactlyOnceWith(1);
        act(() => void vi.advanceTimersByTime(800));
        act(() => result.current.flush());
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('cancel drops the pending call', () => {
        const fn = vi.fn();
        const { result } = renderHook(() => useDebounced(fn, 800));
        act(() => result.current.call(1));
        act(() => result.current.cancel());
        act(() => void vi.advanceTimersByTime(800));
        act(() => result.current.flush());
        expect(fn).not.toHaveBeenCalled();
    });

    it('flushes the pending value on unmount', () => {
        const fn = vi.fn();
        const { result, unmount } = renderHook(() => useDebounced(fn, 800));
        act(() => result.current.call(7));
        unmount();
        expect(fn).toHaveBeenCalledExactlyOnceWith(7);
        vi.advanceTimersByTime(800);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('keeps a stable handle across renders', () => {
        const { result, rerender } = renderHook(() =>
            useDebounced(() => undefined, 800),
        );
        const first = result.current;
        rerender();
        expect(result.current).toBe(first);
    });
});
