import type { RowCountSchema } from '@/types/schema';

/**
 * DBZuper's small Dragon Ball nods. Each one stays out of the way: a tooltip on a big row count, a
 * one-time toast for a seventh pin, and a hidden palette command. Nothing here uses franchise artwork,
 * names or lettering.
 */

/** The row-count tooltip for a table with more than 9,000 rows. */
export const POWER_LEVEL_LINE = "It's over 9,000!";

export const isOverNineThousand = (rc: RowCountSchema): boolean =>
    rc.count !== null && rc.kind !== 'unknown' && rc.count > 9000;

/** Pins it takes to "gather all seven". */
export const SEVEN = 7;

export const SEVEN_LINE = "You've gathered all seven. Make a wish.";

const SEVEN_KEY = 'dbzuper.gathered-seven';

/**
 * True the first time this browser reaches seven pins; false afterwards, and whenever storage is not
 * available (a private window, blocked site data), so the toast never repeats.
 */
export function claimSevenWish(): boolean {
    try {
        if (localStorage.getItem(SEVEN_KEY) !== null) return false;
        localStorage.setItem(SEVEN_KEY, '1');
        return true;
    } catch {
        return false;
    }
}

/** The palette query that reveals the hidden command (matched case- and space-insensitively). */
export const WISH_QUERY = 'make a wish';

export const matchesWish = (query: string): boolean =>
    query.trim().toLowerCase().replace(/\s+/g, ' ') === WISH_QUERY;

export const WISH_LINE =
    'Wish granted. Every table is present and accounted for.';

const WISH_EVENT = 'dbzuper:wish';

/** Plays the wish burst over the workspace (components/workspace/wish-burst.tsx listens). */
export function makeAWish(): void {
    window.dispatchEvent(new Event(WISH_EVENT));
}

export function onWish(listener: () => void): () => void {
    window.addEventListener(WISH_EVENT, listener);

    return () => window.removeEventListener(WISH_EVENT, listener);
}
