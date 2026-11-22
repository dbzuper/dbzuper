import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
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
        expect(result.current.transfer?.status).toBe('pending');
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(result.current.transfer?.status).toBe('running');
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(result.current.transfer?.status).toBe('done');
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
        expect(result.current.transfer).toBeNull();
        expect(show).not.toHaveBeenCalled();
    });
});

describe('useTransferPoll failures', () => {
    it('stops on a 404 and exposes the error', async () => {
        const show = vi
            .spyOn(transfersApi, 'show')
            .mockRejectedValue(
                new ApiError(404, { message: 'No query results.' }),
            );
        const { result } = renderHook(() => useTransferPoll('5', 't1'));
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(result.current.error).toBe('This transfer no longer exists.');
        await act(() => vi.advanceTimersByTimeAsync(5000));
        expect(show).toHaveBeenCalledTimes(1);
    });

    it('stops on a 403 with its message', async () => {
        const show = vi
            .spyOn(transfersApi, 'show')
            .mockRejectedValue(new ApiError(403, { message: 'Forbidden.' }));
        const { result } = renderHook(() => useTransferPoll('5', 't1'));
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(result.current.error).toBe('Forbidden.');
        await act(() => vi.advanceTimersByTimeAsync(5000));
        expect(show).toHaveBeenCalledTimes(1);
    });

    it('reports an error after three failures in a row and clears it on success', async () => {
        vi.spyOn(transfersApi, 'show')
            .mockRejectedValueOnce(new TypeError('network'))
            .mockRejectedValueOnce(new ApiError(502, 'Bad gateway'))
            .mockRejectedValueOnce(new TypeError('network'))
            .mockResolvedValue(make('running'));
        const { result } = renderHook(() => useTransferPoll('5', 't1'));
        await act(() => vi.advanceTimersByTimeAsync(0));
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(result.current.error).toBeNull();
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(result.current.error).toBe(
            "Couldn't reach the server to check on this transfer. Retrying…",
        );
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(result.current.error).toBeNull();
        expect(result.current.transfer?.status).toBe('running');
    });
});

describe('useTransferPoll transient statuses', () => {
    it('keeps polling through a 429, after its Retry-After', async () => {
        const show = vi
            .spyOn(transfersApi, 'show')
            .mockRejectedValueOnce(
                new ApiError(429, { message: 'Too Many Attempts.' }, 5),
            )
            .mockResolvedValue(make('running'));
        const { result } = renderHook(() => useTransferPoll('5', 't1'));
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(result.current.error).toBeNull();
        await act(() => vi.advanceTimersByTimeAsync(4000));
        expect(show).toHaveBeenCalledTimes(1);
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(show).toHaveBeenCalledTimes(2);
        expect(result.current.transfer?.status).toBe('running');
    });

    it('keeps polling through a 408 at the normal pace', async () => {
        const show = vi
            .spyOn(transfersApi, 'show')
            .mockRejectedValueOnce(new ApiError(408, ''))
            .mockResolvedValue(make('running'));
        const { result } = renderHook(() => useTransferPoll('5', 't1'));
        await act(() => vi.advanceTimersByTimeAsync(0));
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(show).toHaveBeenCalledTimes(2);
        expect(result.current.error).toBeNull();
        expect(result.current.transfer?.status).toBe('running');
    });
});
