import { describe, expect, it, vi } from 'vitest';

// jsdom has no WebGL. sigma/rendering reads WebGL2RenderingContext constants at import time,
// so stub them (each name maps to a distinct number) before the module loads.
vi.hoisted(() => {
    const ids = new Map<PropertyKey, number>();
    (globalThis as Record<string, unknown>).WebGL2RenderingContext ??=
        new Proxy(
            {},
            {
                get: (_target, name) => {
                    if (!ids.has(name)) ids.set(name, ids.size + 1);
                    return ids.get(name);
                },
            },
        );
});

import {
    DASH_GAP_PX,
    universePrimitives,
    universeSettings,
    universeStyles,
} from './sigma-options';

const colors = {
    accent: '#2dd4bf',
    dimNode: '#1f2633',
    edge: '#334155',
    edgeInferred: '#1e293b',
    edgeDim: '#0f172a',
    label: '#e2e8f0',
    background: '#0b0e14',
};

describe('sigma options', () => {
    it('declares curved + loop paths and plain + dashed edge layers', () => {
        const p = universePrimitives();
        expect(p.edges.paths.map((x) => x.name)).toEqual(['curved', 'loop']);
        expect(p.edges.layers.map((x) => x.name)).toEqual(['plain', 'dashed']);
    });

    it('dashes inferred edges only and paints gaps with the background', () => {
        const styles = universeStyles(colors);
        expect(styles.edges).toMatchObject({
            path: 'curved',
            dashGap: {
                whenData: { inferred: true },
                // Sigma 4 inline data conditional, not a promise.
                // oxlint-disable-next-line unicorn/no-thenable
                then: DASH_GAP_PX,
                else: 0,
            },
            gapColor: colors.background,
        });
        expect(styles.stage).toEqual({ background: colors.background });
    });

    it('sizes nodes and edges in screen pixels, as the graph model assumes', () => {
        expect(universeSettings().itemSizesReference).toBe('screen');
    });

    it('enables node dragging that pins the dragged table', () => {
        const s = universeSettings();
        expect(s.enableNodeDrag).toBe(true);
        expect(s.dragPositionToAttributes!({ x: 1, y: 2 }, 'orders')).toEqual({
            x: 1,
            y: 2,
            pinned: true,
        });
    });
});
