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
    // Mid-size schemas stay at system zoom at their first view so their labels show.
    if (nodeCount <= LABELLED_FIRST_VIEW_ORDER)
        return { closeup: 0.28, galaxy: 1.5 };
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

/**
 * Camera ratio of the first view. Sigma's ratio 1 fits the graph edge to edge, which clips labels of
 * nodes at the border, so graphs that open labelled get 15% padding; larger ones open fitted.
 */
export function firstViewRatio(nodeCount: number): number {
    return nodeCount <= LABELLED_FIRST_VIEW_ORDER ? 1.15 : 1;
}
