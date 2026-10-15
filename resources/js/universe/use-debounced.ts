import { useCallback, useEffect, useRef } from 'react';

export function useDebounced<T>(
    fn: (value: T) => void,
    ms: number,
): (value: T) => void {
    const fnRef = useRef(fn);
    fnRef.current = fn;
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
        },
        [],
    );

    return useCallback(
        (value: T) => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => fnRef.current(value), ms);
        },
        [ms],
    );
}
