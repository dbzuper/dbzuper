import { describe, expect, it } from 'vitest';
import { makeSnapshot } from './__fixtures__/snapshot';
import { buildSchemaGraph, edgeKey } from './graph';
import {
    buildDisplayState,
    displayInputsChanged,
    edgeDisplay,
    neighborhood,
    nodeDisplay,
    withAlpha,
    type UniverseColors,
} from './reducers';
import { zoomLevelFor } from './zoom';

const colors: UniverseColors = {
    accent: '#2dd4bf',
    dimNode: '#1f2633',
    edge: 'rgba(1,1,1,0.3)',
    edgeInferred: 'rgba(1,1,1,0.15)',
    edgeDim: 'rgba(1,1,1,0.05)',
    label: '#e2e8f0',
    background: '#0b0e14',
};

const graph = buildSchemaGraph(
    makeSnapshot(
        [
            { name: 'users' },
            { name: 'orders' },
            { name: 'items' },
            { name: 'products' },
            { name: 'logs' },
            { name: 'v', kind: 'view' },
        ],
        [
            { from_table: 'orders', to_table: 'users' },
            { from_table: 'items', to_table: 'orders' },
            { from_table: 'items', to_table: 'products' },
            { from_table: 'logs', to_table: 'users', inferred: true },
        ],
    ),
);
graph.updateEachNodeAttributes((_k, a) => ({ ...a, color: '#6f9fc8' }));

const base = {
    hovered: null,
    selected: null,
    path: null,
    focus: null,
    showInferred: true,
    zoomLevel: 'system' as const,
};

describe('zoomLevelFor', () => {
    it.each([
        [1, 500, 'galaxy'],
        [0.4, 500, 'system'],
        [0.2, 500, 'closeup'],
        [1, 10, 'system'],
        [0.5, 10, 'closeup'],
    ] as const)('ratio %s with %s nodes → %s', (ratio, n, level) => {
        expect(zoomLevelFor(ratio, n)).toBe(level);
    });
});

describe('neighborhood', () => {
    it('walks 1 and 2 hops and respects the inferred toggle', () => {
        expect([...neighborhood(graph, 'users', 1, true)].sort()).toEqual([
            'logs',
            'orders',
            'users',
        ]);
        expect([...neighborhood(graph, 'users', 1, false)].sort()).toEqual([
            'orders',
            'users',
        ]);
        expect([...neighborhood(graph, 'users', 2, false)].sort()).toEqual([
            'items',
            'orders',
            'users',
        ]);
    });
});

describe('nodeDisplay', () => {
    it('shows labels only at system zoom when nothing is highlighted', () => {
        const at = (zoomLevel: 'galaxy' | 'system' | 'closeup') =>
            nodeDisplay(
                'users',
                graph.getNodeAttributes('users'),
                buildDisplayState(graph, { ...base, zoomLevel }, colors),
            );
        expect(at('system')).toMatchObject({
            label: 'users',
            labelVisibility: 'auto',
        });
        expect(at('galaxy').labelVisibility).toBe('hidden');
        expect(at('closeup').labelVisibility).toBe('hidden');
    });

    it('dims non-neighbours of the hovered table and accents the selected one', () => {
        const s = buildDisplayState(
            graph,
            { ...base, hovered: 'orders', selected: 'orders' },
            colors,
        );
        expect(
            nodeDisplay('products', graph.getNodeAttributes('products'), s)
                .color,
        ).toBe(colors.dimNode);
        expect(
            nodeDisplay('users', graph.getNodeAttributes('users'), s)
                .highlighted,
        ).toBe(true);
        expect(
            nodeDisplay('orders', graph.getNodeAttributes('orders'), s).color,
        ).toBe(colors.accent);
    });

    it('hides tables outside the focus neighbourhood', () => {
        const s = buildDisplayState(
            graph,
            { ...base, focus: { table: 'products', depth: 1 } },
            colors,
        );
        expect(
            nodeDisplay('users', graph.getNodeAttributes('users'), s)
                .visibility,
        ).toBe('hidden');
        expect(
            nodeDisplay('items', graph.getNodeAttributes('items'), s)
                .visibility,
        ).toBeUndefined();
    });

    it('renders views semi-transparent', () => {
        expect(
            nodeDisplay(
                'v',
                graph.getNodeAttributes('v'),
                buildDisplayState(graph, base, colors),
            ).color,
        ).toBe('rgba(111,159,200,0.5)');
    });
});

describe('edgeDisplay', () => {
    const show = (key: string, s: ReturnType<typeof buildDisplayState>) =>
        edgeDisplay(
            key,
            graph.getEdgeAttributes(key),
            graph.source(key),
            graph.target(key),
            s,
        );

    it('hides inferred edges when toggled off and draws them lighter otherwise', () => {
        const key = edgeKey('logs', 'users');
        expect(
            show(
                key,
                buildDisplayState(
                    graph,
                    { ...base, showInferred: false },
                    colors,
                ),
            ).visibility,
        ).toBe('hidden');
        expect(show(key, buildDisplayState(graph, base, colors)).color).toBe(
            colors.edgeInferred,
        );
    });

    it('accents path edges and dims the rest', () => {
        const s = buildDisplayState(
            graph,
            { ...base, path: ['users', 'orders', 'items'] },
            colors,
        );
        expect(show(edgeKey('users', 'orders'), s).color).toBe(colors.accent);
        expect(show(edgeKey('items', 'products'), s).color).toBe(
            colors.edgeDim,
        );
    });

    it('accents edges touching the hovered table', () => {
        const s = buildDisplayState(
            graph,
            { ...base, hovered: 'products' },
            colors,
        );
        expect(show(edgeKey('items', 'products'), s).color).toBe(colors.accent);
        expect(show(edgeKey('orders', 'users'), s).color).toBe(colors.edgeDim);
    });
});

describe('withAlpha', () => {
    it('converts hex to rgba', () => {
        expect(withAlpha('#ff8000', 0.25)).toBe('rgba(255,128,0,0.25)');
        expect(withAlpha('rgb(1,2,3)', 0.5)).toBe('rgb(1,2,3)');
    });
});

describe('displayInputsChanged', () => {
    const prev = {
        ...base,
        paletteOpen: false,
        inspectorTab: 'columns' as const,
    };

    it('ignores state that does not affect the graph', () => {
        const palette = { ...prev, paletteOpen: true };
        const tab = { ...prev, inspectorTab: 'ddl' as const };
        expect(displayInputsChanged(prev, { ...prev })).toBe(false);
        expect(displayInputsChanged(prev, palette)).toBe(false);
        expect(displayInputsChanged(prev, tab)).toBe(false);
    });

    it.each([
        ['hovered', 'users'],
        ['selected', 'users'],
        ['path', ['users', 'orders']],
        ['focus', { table: 'users', depth: 1 }],
        ['showInferred', false],
        ['zoomLevel', 'galaxy'],
    ] as const)('detects a %s change', (field, value) => {
        expect(displayInputsChanged(prev, { ...prev, [field]: value })).toBe(
            true,
        );
    });
});
