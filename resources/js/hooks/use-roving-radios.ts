import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

const STEP: Record<string, number> = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
};

/**
 * Roving tabindex for a group of `role="radio"` buttons: one tab stop (the checked radio), arrow keys
 * move focus round the group (wrapping; Home and End jump to the ends) and Enter or Space select,
 * as the buttons' own click.
 */
export function useRovingRadios<T>(values: readonly T[], checked: T) {
    const refs = useRef<(HTMLButtonElement | null)[]>([]);
    const indexOf = (value: T) => Math.max(0, values.indexOf(value));
    const [active, setActive] = useState(() => indexOf(checked));
    const [lastChecked, setLastChecked] = useState(checked);

    // A new selection (here or from another control) takes the tab stop with it.
    if (lastChecked !== checked) {
        setLastChecked(checked);
        setActive(indexOf(checked));
    }

    const move = (to: number) => {
        setActive(to);
        refs.current[to]?.focus();
    };

    return (index: number) => ({
        ref: (el: HTMLButtonElement | null) => {
            refs.current[index] = el;
        },
        tabIndex: index === active ? 0 : -1,
        onFocus: () => setActive(index),
        onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
            const last = values.length - 1;
            let to: number | undefined;

            if (e.key in STEP) {
                to = (index + STEP[e.key] + values.length) % values.length;
            } else if (e.key === 'Home') {
                to = 0;
            } else if (e.key === 'End') {
                to = last;
            }

            if (to !== undefined) {
                e.preventDefault();
                move(to);
            }
        },
    });
}
