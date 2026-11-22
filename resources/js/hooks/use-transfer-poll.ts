import { useEffect, useState } from 'react';
import type { WorkspaceRef } from '@/types/connection';
import { ACTIVE_STATUSES, transfersApi } from '@/lib/transfers-api';
import type { Transfer } from '@/lib/transfers-api';

export const POLL_INTERVAL_MS = 1000;

/** Polls one transfer every second while it is active; stops when it finishes or the component unmounts. */
export function useTransferPoll(
    ref: WorkspaceRef,
    id: string | null,
): Transfer | null {
    const [transfer, setTransfer] = useState<Transfer | null>(null);

    useEffect(() => {
        setTransfer(null);
        if (id === null) return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();

        const tick = async () => {
            try {
                const next = await transfersApi.show(
                    ref,
                    id,
                    controller.signal,
                );
                if (stopped) return;
                setTransfer(next);
                if (!ACTIVE_STATUSES.includes(next.status)) return;
            } catch {
                // A failed poll is retried on the next tick.
                if (stopped) return;
            }
            timer = setTimeout(tick, POLL_INTERVAL_MS);
        };
        void tick();

        return () => {
            stopped = true;
            controller.abort();
            clearTimeout(timer);
        };
    }, [ref, id]);

    return transfer;
}
