import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/http';
import type { WorkspaceRef } from '@/types/connection';
import { ACTIVE_STATUSES, transfersApi } from '@/lib/transfers-api';
import type { Transfer } from '@/lib/transfers-api';

export const POLL_INTERVAL_MS = 1000;
/** Failed polls in a row before the error is shown; polling goes on meanwhile. */
export const POLL_FAILURES_BEFORE_ERROR = 3;

/** Statuses that mean "try again later", not "this transfer is gone". */
const TRANSIENT_STATUSES = [408, 429];

export const POLL_RETRY_MESSAGE =
    "Couldn't reach the server to check on this transfer. Retrying…";

export type TransferPoll = {
    transfer: Transfer | null;
    /** Set after a 4xx (polling stops) or after several failed polls in a row (polling goes on). */
    error: string | null;
};

function messageOf(body: unknown): string | null {
    if (body && typeof body === 'object' && 'message' in body) {
        const m = (body as { message: unknown }).message;
        if (typeof m === 'string' && m !== '') return m;
    }
    return null;
}

/**
 * Polls one transfer every second while it is active; stops when it finishes, the component unmounts, or the
 * server answers with a 4xx (the transfer is gone or not this user's).
 */
export function useTransferPoll(
    ref: WorkspaceRef,
    id: string | null,
): TransferPoll {
    const [state, setState] = useState<TransferPoll>({
        transfer: null,
        error: null,
    });

    useEffect(() => {
        setState({ transfer: null, error: null });
        if (id === null) return;
        let stopped = false;
        let failures = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();

        const tick = async () => {
            let delay = POLL_INTERVAL_MS;
            try {
                const next = await transfersApi.show(
                    ref,
                    id,
                    controller.signal,
                );
                if (stopped) return;
                failures = 0;
                setState({ transfer: next, error: null });
                if (!ACTIVE_STATUSES.includes(next.status)) return;
            } catch (e) {
                if (stopped) return;
                // Rate-limited (429) or timed out (408): transient, so keep polling, after Retry-After when given.
                const transient =
                    e instanceof ApiError &&
                    TRANSIENT_STATUSES.includes(e.status);
                if (e instanceof ApiError && transient && e.retryAfter !== null)
                    delay = Math.max(POLL_INTERVAL_MS, e.retryAfter * 1000);
                if (
                    !transient &&
                    e instanceof ApiError &&
                    e.status >= 400 &&
                    e.status < 500
                ) {
                    const error =
                        e.status === 404
                            ? 'This transfer no longer exists.'
                            : (messageOf(e.body) ??
                              `Couldn't check on this transfer (status ${e.status}).`);
                    setState((s) => ({ ...s, error }));
                    return;
                }
                // A rate limit or timeout is the server answering: not a failure to reach it.
                if (!transient) failures++;
                if (failures >= POLL_FAILURES_BEFORE_ERROR)
                    setState((s) => ({ ...s, error: POLL_RETRY_MESSAGE }));
            }
            timer = setTimeout(tick, delay);
        };
        void tick();

        return () => {
            stopped = true;
            controller.abort();
            clearTimeout(timer);
        };
    }, [ref, id]);

    return state;
}
