import type { ZoomLevel } from './store';

/** Semantic zoom level from Sigma's camera ratio (smaller ratio = closer). */
export function zoomLevelFor(ratio: number, nodeCount: number): ZoomLevel {
    if (nodeCount <= 25) return ratio <= 0.6 ? 'closeup' : 'system';
    if (ratio <= 0.28) return 'closeup';
    return ratio >= 0.65 ? 'galaxy' : 'system';
}
