import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transfersApi } from '@/lib/transfers-api';
import type { Transfer, TransferStatus } from '@/lib/transfers-api';
import { useTransferPoll } from './use-transfer-poll';

const make = (status: TransferStatus) => ({ id: 't1', status }) as Transfer;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useTransferPoll', () => {
    it('polls every second and stops at done', async () => {
        const show = vi
            .spyOn(transfersApi, 'show')
            .mockResolvedValueOnce(make('pending'))
            .mockResolvedValueOnce(make('running'))
            .mockResolvedValue(make('done'));

        const { result } = renderHook(() => useTransferPoll('5', 't1'));
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(result.current?.status).toBe('pending');
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(result.current?.status).toBe('running');
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(result.current?.status).toBe('done');
        const calls = show.mock.calls.length;
        await act(() => vi.advanceTimersByTimeAsync(5000));
        expect(show).toHaveBeenCalledTimes(calls);
    });

    it('does not overlap requests', async () => {
        let release: (t: Transfer) => void = () => {};
        const show = vi
            .spyOn(transfersApi, 'show')
            .mockImplementation(
                () => new Promise<Transfer>((r) => (release = r)),
            );
        renderHook(() => useTransferPoll('5', 't1'));
        await act(() => vi.advanceTimersByTimeAsync(5000));
        expect(show).toHaveBeenCalledTimes(1);
        release(make('running'));
    });

    it('stops on unmount', async () => {
        const show = vi
            .spyOn(transfersApi, 'show')
            .mockResolvedValue(make('running'));
        const { unmount } = renderHook(() => useTransferPoll('5', 't1'));
        await act(() => vi.advanceTimersByTimeAsync(1000));
        unmount();
        const calls = show.mock.calls.length;
        await act(() => vi.advanceTimersByTimeAsync(5000));
        expect(show).toHaveBeenCalledTimes(calls);
    });

    it('does nothing without an id', async () => {
        const show = vi.spyOn(transfersApi, 'show');
        const { result } = renderHook(() => useTransferPoll('5', null));
        await act(() => vi.advanceTimersByTimeAsync(3000));
        expect(result.current).toBeNull();
        expect(show).not.toHaveBeenCalled();
    });
});
