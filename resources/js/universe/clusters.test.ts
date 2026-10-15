import { describe, expect, it } from 'vitest';
import { makeSnapshot } from './__fixtures__/snapshot';
import {
    assignClusters,
    CLUSTER_PALETTE,
    ISOLATED_CLUSTER,
    ISOLATED_COLOR,
    prefixOf,
} from './clusters';
import { buildSchemaGraph } from './graph';

function clique(prefix: string, n: number) {
    const tables = Array.from({ length: n }, (_, i) => ({
        name: `${prefix}${i}`,
    }));
    const rels = [];
    for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++)
            rels.push({
                from_table: `${prefix}${i}`,
                to_table: `${prefix}${j}`,
            });
    return { tables, rels };
}

describe('assignClusters', () => {
    it('separates two dense components into two clusters', () => {
        const a = clique('shop_', 5);
        const b = clique('blog_', 4);
        const graph = buildSchemaGraph(
            makeSnapshot([...a.tables, ...b.tables], [...a.rels, ...b.rels]),
        );
        const clusters = assignClusters(graph);

        expect(clusters.map((c) => c.members.length)).toEqual([5, 4]);
        expect(clusters.map((c) => c.label)).toEqual(['shop_*', 'blog_*']);
        expect(clusters[0].color).toBe(CLUSTER_PALETTE[0]);
        expect(graph.getNodeAttribute('blog_0', 'cluster')).toBe(
            clusters[1].id,
        );
        expect(graph.getNodeAttribute('blog_0', 'color')).toBe(
            CLUSTER_PALETTE[1],
        );
    });

    it('is deterministic', () => {
        const build = () => {
            const a = clique('x_', 6);
            const b = clique('y_', 6);
            const g = buildSchemaGraph(
                makeSnapshot(
                    [...a.tables, ...b.tables],
                    [
                        ...a.rels,
                        ...b.rels,
                        { from_table: 'x_0', to_table: 'y_0' },
                    ],
                ),
            );
            return assignClusters(g).map((c) => [c.id, c.label, c.members]);
        };
        expect(build()).toEqual(build());
    });

    it('labels by the most connected table when no prefix dominates', () => {
        const graph = buildSchemaGraph(
            makeSnapshot(
                [
                    { name: 'users' },
                    { name: 'orders' },
                    { name: 'invoices' },
                    { name: 'sessions' },
                ],
                [
                    { from_table: 'orders', to_table: 'users' },
                    { from_table: 'invoices', to_table: 'users' },
                    { from_table: 'sessions', to_table: 'users' },
                ],
            ),
        );
        expect(assignClusters(graph)[0].label).toBe('users');
    });

    it('groups unrelated tables by shared prefix and puts the rest in an outer cluster', () => {
        const graph = buildSchemaGraph(
            makeSnapshot([
                { name: 'wp_posts' },
                { name: 'wp_options' },
                { name: 'audit_log' },
                { name: 'settings' },
            ]),
        );
        const clusters = assignClusters(graph);

        expect(clusters.map((c) => [c.label, c.members, c.outer])).toEqual([
            ['wp_*', ['wp_options', 'wp_posts'], false],
            ['Unrelated tables', ['audit_log', 'settings'], true],
        ]);
        expect(clusters[1].id).toBe(ISOLATED_CLUSTER);
        expect(graph.getNodeAttribute('settings', 'color')).toBe(
            ISOLATED_COLOR,
        );
    });

    it('treats a table whose only relationship is to itself as unrelated', () => {
        const graph = buildSchemaGraph(
            makeSnapshot(
                [{ name: 'categories' }],
                [{ from_table: 'categories', to_table: 'categories' }],
            ),
        );
        expect(assignClusters(graph)).toEqual([
            {
                id: ISOLATED_CLUSTER,
                label: 'Unrelated tables',
                color: ISOLATED_COLOR,
                members: ['categories'],
                outer: true,
            },
        ]);
    });

    it('returns no clusters for an empty graph', () => {
        expect(assignClusters(buildSchemaGraph(makeSnapshot([])))).toEqual([]);
    });
});

describe('prefixOf', () => {
    it('needs at least two characters before the first underscore', () => {
        expect(prefixOf('wp_posts')).toBe('wp');
        expect(prefixOf('Shop_Items')).toBe('shop');
        expect(prefixOf('a_b')).toBeNull();
        expect(prefixOf('users')).toBeNull();
        expect(prefixOf('_x')).toBeNull();
    });
});
