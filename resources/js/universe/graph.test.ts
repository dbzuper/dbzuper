import { describe, expect, it } from 'vitest';
import { makeSnapshot } from './__fixtures__/snapshot';
import { buildSchemaGraph, edgeKey, nodeSizeFor } from './graph';

describe('buildSchemaGraph', () => {
    const snapshot = makeSnapshot(
        [
            { name: 'users' },
            { name: 'orders' },
            { name: 'categories' },
            {
                name: 'order_totals',
                kind: 'view',
                row_count: { count: null, kind: 'unknown' },
            },
        ],
        [
            {
                from_table: 'orders',
                to_table: 'users',
                from_columns: ['user_id'],
            },
            {
                from_table: 'orders',
                to_table: 'users',
                from_columns: ['approver_id'],
                inferred: true,
            },
            {
                from_table: 'categories',
                to_table: 'categories',
                from_columns: ['parent_id'],
            },
            { from_table: 'orders', to_table: 'ghost_table' },
        ],
    );
    const graph = buildSchemaGraph(snapshot);

    it('adds one node per table and view with display attributes', () => {
        expect(graph.order).toBe(4);
        expect(graph.getNodeAttributes('order_totals')).toMatchObject({
            label: 'order_totals',
            kind: 'view',
            rows: null,
            columns: 1,
            pinned: false,
        });
        expect(graph.getNodeAttribute('users', 'size')).toBe(nodeSizeFor(10));
    });

    it('aggregates relationships per table pair and ignores missing tables', () => {
        const key = edgeKey('orders', 'users');
        expect(graph.hasEdge(key)).toBe(true);
        expect(graph.getEdgeAttributes(key)).toMatchObject({
            weight: 2,
            inferred: false,
        });
        expect(graph.getEdgeAttribute(key, 'relationships')).toHaveLength(2);
        expect(graph.size).toBe(2); // orders–users and the categories self-loop
    });

    it('marks an edge inferred only when every relationship on it is inferred', () => {
        const s = makeSnapshot(
            [{ name: 'a' }, { name: 'b' }],
            [{ from_table: 'a', to_table: 'b', inferred: true }],
        );
        expect(
            buildSchemaGraph(s).getEdgeAttribute(edgeKey('a', 'b'), 'inferred'),
        ).toBe(true);
    });

    it('handles an empty schema', () => {
        expect(buildSchemaGraph(makeSnapshot([])).order).toBe(0);
    });
});

describe('helpers', () => {
    it('sizes nodes monotonically with rows and clamps', () => {
        expect(nodeSizeFor(null)).toBe(5);
        expect(nodeSizeFor(0)).toBeLessThan(nodeSizeFor(1000));
        expect(nodeSizeFor(1e12)).toBe(20);
    });

    it('builds symmetric edge keys', () => {
        expect(edgeKey('a', 'b')).toBe(edgeKey('b', 'a'));
    });
});
