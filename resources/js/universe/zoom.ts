import type { ZoomLevel } from './store';

/** A level is left only once the ratio is this far (10%) past the threshold that entered it. */
export const ZOOM_HYSTERESIS = 0.1;

/** Up to this many tables the first view is labelled; larger schemas open at galaxy zoom. */
export const LABELLED_FIRST_VIEW_ORDER = 100;

type Thresholds = {
    /** Closeup at or below this ratio. */
    closeup: number;
    /** Galaxy at or above this ratio (null: never). */
    galaxy: number | null;
};

function thresholdsFor(nodeCount: number): Thresholds {
    if (nodeCount <= 25) return { closeup: 0.6, galaxy: null };
    // Mid-size schemas stay at system zoom at the fitted view (ratio 1) so their labels show.
    if (nodeCount <= LABELLED_FIRST_VIEW_ORDER)
        return { closeup: 0.28, galaxy: 1.15 };
    return { closeup: 0.28, galaxy: 0.65 };
}

/**
 * Semantic zoom level from Sigma's camera ratio (smaller ratio = closer). `previous` is the level
 * currently shown: it is kept until the ratio clears its threshold by the hysteresis band, so a
 * camera hovering at a boundary does not flicker between levels.
 */
export function zoomLevelFor(
    ratio: number,
    nodeCount: number,
    previous?: ZoomLevel,
): ZoomLevel {
    const { closeup, galaxy } = thresholdsFor(nodeCount);
    if (previous === 'closeup' && ratio <= closeup * (1 + ZOOM_HYSTERESIS))
        return 'closeup';
    if (
        previous === 'galaxy' &&
        galaxy !== null &&
        ratio >= galaxy * (1 - ZOOM_HYSTERESIS)
    )
        return 'galaxy';
    if (ratio <= closeup) return 'closeup';
    return galaxy !== null && ratio >= galaxy ? 'galaxy' : 'system';
}

/** Camera ratio of the first view: the fitted graph (1), which is labelled for up to 100 tables. */
export function firstViewRatio(_nodeCount: number): number {
    return 1;
}
