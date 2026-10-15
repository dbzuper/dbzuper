import type { Settings } from 'sigma/settings';
import { layerDashed, layerPlain, pathCurved, pathLoop } from 'sigma/rendering';
import { MIN_NODE_SIZE } from './graph';
import type { UniverseColors } from './reducers';

/** Gap between dashes for inferred relationships, in pixels (0 = solid). */
export const DASH_GAP_PX = 4;

/**
 * Edges render a solid plain layer with a dashed layer on top. The dashed layer is a no-op when the
 * per-edge `dashGap` variable is 0 (declared FKs). For inferred edges it paints the gaps in the stage
 * background colour, so the edge reads as dashed.
 */
export function universePrimitives() {
    return {
        edges: {
            paths: [pathCurved({ curvature: 0.18 }), pathLoop()],
            variables: {
                dashGap: { type: 'number' as const, default: 0 },
                gapColor: { type: 'color' as const, default: '#0b0e14' },
            },
            layers: [
                layerPlain(),
                layerDashed({
                    dashSize: { value: 5, mode: 'pixels' },
                    gapSize: {
                        attribute: 'dashGap',
                        default: 0,
                        mode: 'pixels',
                    },
                    gapColor: { attribute: 'gapColor' },
                }),
            ],
        },
    };
}

export function universeStyles(colors: UniverseColors) {
    return {
        nodes: {
            x: { attribute: 'x' },
            y: { attribute: 'y' },
            size: { attribute: 'size', defaultValue: MIN_NODE_SIZE },
            color: { attribute: 'color', defaultValue: '#8a8f98' },
            label: { attribute: 'label' },
            labelColor: colors.label,
            labelFont: 'Geist Variable, ui-sans-serif, system-ui, sans-serif',
            cursor: 'pointer',
        },
        edges: {
            path: 'curved',
            size: { attribute: 'size', defaultValue: 1 },
            color: colors.edge,
            dashGap: {
                whenData: { inferred: true },
                // Sigma 4 inline data conditional, not a promise.
                // oxlint-disable-next-line unicorn/no-thenable
                then: DASH_GAP_PX,
                else: 0,
            },
            gapColor: colors.background,
        },
        stage: { background: colors.background },
    };
}

/** Graphs up to this many nodes label every node the label grid has room for, whatever its size. */
export const SMALL_GRAPH_ORDER = 100;

export function universeSettings(
    order = Number.POSITIVE_INFINITY,
): Partial<Settings> {
    return {
        allowInvalidContainer: true,
        // Sigma 4 defaults to "positions" (sizes in graph units); node/edge sizes are screen pixels.
        itemSizesReference: 'screen',
        // Large graphs only label nodes drawn at 6 px or more. Small ones label everything: the
        // label grid (labelDensity per cell) still drops labels that would collide.
        labelRenderedSizeThreshold: order <= SMALL_GRAPH_ORDER ? 0 : 6,
        minCameraRatio: 0.02,
        maxCameraRatio: 4,
        enableNodeDrag: true,
        dragPositionToAttributes: (position, _node) => ({
            x: position.x,
            y: position.y,
            pinned: true,
        }),
    };
}
