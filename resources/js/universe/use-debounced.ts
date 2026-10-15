import { useEffect, useMemo, useRef } from 'react';

export type Debounced<T> = {
    /** Schedules `fn(value)` after the delay, replacing any pending call. */
    call: (value: T) => void;
    /** Runs the pending call now, if there is one. */
    flush: () => void;
    /** Drops the pending call. */
    cancel: () => void;
};

/** Trailing debounce with a stable handle. A call still pending at unmount is flushed, not lost. */
export function useDebounced<T>(
    fn: (value: T) => void,
    ms: number,
): Debounced<T> {
    const fnRef = useRef(fn);
    fnRef.current = fn;
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pending = useRef<{ value: T } | null>(null);

    const handle = useMemo<Debounced<T>>(() => {
        const cancel = () => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = null;
            pending.current = null;
        };
        const flush = () => {
            const p = pending.current;
            cancel();
            if (p) fnRef.current(p.value);
        };
        const call = (value: T) => {
            if (timer.current) clearTimeout(timer.current);
            pending.current = { value };
            timer.current = setTimeout(flush, ms);
        };
        return { call, flush, cancel };
    }, [ms]);

    useEffect(() => () => handle.flush(), [handle]);

    return handle;
}
