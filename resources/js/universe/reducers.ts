import type { EdgeDisplayData, NodeDisplayData } from 'sigma/types';
import {
    edgeKey,
    type RelationEdgeAttributes,
    type SchemaGraph,
    type TableNodeAttributes,
} from './graph';
import type { WorkspaceState, ZoomLevel } from './store';

export type UniverseColors = {
    accent: string;
    dimNode: string;
    edge: string;
    edgeInferred: string;
    edgeDim: string;
    label: string;
    background: string;
};

export type DisplayState = {
    center: string | null;
    selected: string | null;
    highlight: Set<string> | null;
    pathEdges: Set<string> | null;
    focus: Set<string> | null;
    showInferred: boolean;
    zoomLevel: ZoomLevel;
    colors: UniverseColors;
};

export function withAlpha(color: string, alpha: number): string {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
    if (!m) return color;
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

export function neighborhood(
    graph: SchemaGraph,
    start: string,
    depth: number,
    includeInferred: boolean,
): Set<string> {
    const seen = new Set([start]);
    let frontier = [start];
    for (let d = 0; d < depth; d++) {
        const next: string[] = [];
        for (const node of frontier) {
            graph.forEachEdge(node, (_edge, attrs, source, target) => {
                if (!includeInferred && attrs.inferred) return;
                const other = source === node ? target : source;
                if (!seen.has(other)) {
                    seen.add(other);
                    next.push(other);
                }
            });
        }
        frontier = next;
    }
    return seen;
}

type DisplayInputs = Pick<
    WorkspaceState,
    'hovered' | 'selected' | 'path' | 'focus' | 'showInferred' | 'zoomLevel'
>;

export function buildDisplayState(
    graph: SchemaGraph,
    ws: DisplayInputs,
    colors: UniverseColors,
): DisplayState {
    const center = ws.hovered ?? ws.selected;
    const path = ws.path && ws.path.length > 1 ? ws.path : null;
    let highlight: Set<string> | null = null;
    if (path) highlight = new Set(path);
    else if (center && graph.hasNode(center))
        highlight = neighborhood(graph, center, 1, ws.showInferred);

    return {
        center: path ? null : center,
        selected: ws.selected,
        highlight,
        pathEdges: path
            ? new Set(path.slice(1).map((t, i) => edgeKey(path[i], t)))
            : null,
        focus:
            ws.focus && graph.hasNode(ws.focus.table)
                ? neighborhood(
                      graph,
                      ws.focus.table,
                      ws.focus.depth,
                      ws.showInferred,
                  )
                : null,
        showInferred: ws.showInferred,
        zoomLevel: ws.zoomLevel,
        colors,
    };
}

/**
 * Sigma 4 node reducer body: overrides applied on top of the style-derived display data.
 * v4 display fields: `visibility`, `labelVisibility` ('auto' | 'visible' | 'hidden'), `depth`, `zIndex`.
 */
export function nodeDisplay(
    node: string,
    data: TableNodeAttributes,
    s: DisplayState,
): Partial<NodeDisplayData> {
    if (s.focus && !s.focus.has(node))
        return { visibility: 'hidden', labelVisibility: 'hidden' };

    const out: Partial<NodeDisplayData> = {
        color: data.kind === 'view' ? withAlpha(data.color, 0.5) : data.color,
        label: data.label,
        labelVisibility: s.zoomLevel === 'system' ? 'auto' : 'hidden',
        zIndex: 0,
    };

    if (s.highlight) {
        if (s.highlight.has(node)) {
            out.highlighted = true;
            out.zIndex = 1;
            out.depth = 'topNodes';
            out.labelVisibility = s.zoomLevel === 'closeup' ? 'hidden' : 'auto';
        } else {
            out.color = s.colors.dimNode;
            out.labelVisibility = 'hidden';
        }
    }

    if (node === s.selected) {
        out.color = s.colors.accent;
        out.highlighted = true;
        out.zIndex = 2;
        out.depth = 'topNodes';
        out.labelVisibility = s.zoomLevel === 'closeup' ? 'hidden' : 'visible';
    }

    return out;
}

/** Sigma 4 edge reducer body. Inferred edges get their dash pattern from the styles (sigma-options.ts). */
export function edgeDisplay(
    edge: string,
    data: RelationEdgeAttributes,
    source: string,
    target: string,
    s: DisplayState,
): Partial<EdgeDisplayData> {
    if (!s.showInferred && data.inferred) return { visibility: 'hidden' };
    if (s.focus && (!s.focus.has(source) || !s.focus.has(target)))
        return { visibility: 'hidden' };

    const out: Partial<EdgeDisplayData> = {
        size: data.size,
        color: data.inferred ? s.colors.edgeInferred : s.colors.edge,
        zIndex: 0,
    };

    if (s.pathEdges) {
        if (s.pathEdges.has(edge)) {
            out.color = s.colors.accent;
            out.size = data.size + 1.5;
            out.zIndex = 1;
            out.depth = 'topEdges';
        } else {
            out.color = s.colors.edgeDim;
        }
    } else if (s.center) {
        if (source === s.center || target === s.center) {
            out.color = s.colors.accent;
            out.zIndex = 1;
            out.depth = 'topEdges';
        } else {
            out.color = s.colors.edgeDim;
        }
    }

    return out;
}
