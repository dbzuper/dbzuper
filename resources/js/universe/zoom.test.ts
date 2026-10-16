import { describe, expect, it } from 'vitest';
import { firstViewRatio, zoomLevelFor } from './zoom';

describe('first view', () => {
    it.each([5, 25, 26, 30, 60, 90, 100])(
        'shows labels (system level) for %i tables',
        (n) => {
            expect(zoomLevelFor(firstViewRatio(n), n)).toBe('system');
        },
    );

    it('keeps very large schemas at galaxy zoom on first view', () => {
        expect(zoomLevelFor(firstViewRatio(2000), 2000)).toBe('galaxy');
    });

    it('still reaches galaxy when a mid-size schema is zoomed out', () => {
        expect(zoomLevelFor(3, 60)).toBe('galaxy');
    });
});

describe('zoomLevelFor hysteresis', () => {
    it('leaves closeup only 10% beyond the entry threshold', () => {
        expect(zoomLevelFor(0.28, 60)).toBe('closeup');
        expect(zoomLevelFor(0.29, 60, 'system')).toBe('system');
        expect(zoomLevelFor(0.29, 60, 'closeup')).toBe('closeup');
        expect(zoomLevelFor(0.3, 60, 'closeup')).toBe('closeup');
        expect(zoomLevelFor(0.31, 60, 'closeup')).toBe('system');
    });

    it('leaves galaxy only 10% beyond the entry threshold', () => {
        expect(zoomLevelFor(0.65, 500)).toBe('galaxy');
        expect(zoomLevelFor(0.62, 500, 'system')).toBe('system');
        expect(zoomLevelFor(0.62, 500, 'galaxy')).toBe('galaxy');
        expect(zoomLevelFor(0.59, 500, 'galaxy')).toBe('galaxy');
        expect(zoomLevelFor(0.58, 500, 'galaxy')).toBe('system');
    });

    it('applies the band to small graphs and jumps straight across levels', () => {
        expect(zoomLevelFor(0.64, 10, 'closeup')).toBe('closeup');
        expect(zoomLevelFor(0.67, 10, 'closeup')).toBe('system');
        expect(zoomLevelFor(0.1, 500, 'galaxy')).toBe('closeup');
    });

    it('does not flicker while the camera hovers around a boundary', () => {
        let level = zoomLevelFor(0.7, 500);
        const seen = new Set<string>();
        for (const r of [0.64, 0.66, 0.64, 0.62, 0.66, 0.6]) {
            level = zoomLevelFor(r, 500, level);
            seen.add(level);
        }
        expect(seen.size).toBe(1);
    });
});
