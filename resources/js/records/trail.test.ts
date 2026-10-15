import { describe, expect, it } from 'vitest';
import {
    CARD_MAX_HEIGHT,
    MAX_NODES,
    ROW_GAP,
    addRelated,
    emptyTrail,
    nodeId,
    openRoot,
    pathTo,
    placements,
    select,
} from './trail';

const t = (table: string, id: number) => ({ table, key: { id } });

describe('trail', () => {
    it('keeps rows further apart than a card is tall', () => {
        expect(ROW_GAP).toBeGreaterThan(CARD_MAX_HEIGHT);
    });

    it('opens a root that is selected', () => {
        const trail = openRoot('users', { id: 1 });
        expect(trail.nodes).toHaveLength(1);
        expect(trail.selected).toBe(trail.nodes[0].id);
        expect(emptyTrail().nodes).toEqual([]);
    });

    it('adds children with edges and de-duplicates', () => {
        const root = openRoot('users', { id: 1 });
        const a = addRelated(root, root.nodes[0].id, 'r1', 'in', [
            t('orders', 1),
            t('orders', 2),
            t('orders', 3),
        ]);
        expect(a.trail.nodes).toHaveLength(4);
        expect(a.trail.edges).toHaveLength(3);
        expect(a.added).toHaveLength(3);
        const b = addRelated(a.trail, root.nodes[0].id, 'r1', 'in', [
            t('orders', 1),
            t('orders', 4),
        ]);
        expect(b.trail.nodes).toHaveLength(5);
        expect(b.added).toEqual([nodeId('orders', { id: 4 })]);
        const c = addRelated(a.trail, a.added[0], 'r1', 'out', [t('users', 1)]);
        expect(c.trail.nodes).toHaveLength(4);
        expect(c.trail.edges).toHaveLength(4);
        expect(c.added).toEqual([]);
    });

    it('ignores property order in composite keys', () => {
        expect(nodeId('x', { a: 1, b: 'q' })).toBe(
            nodeId('x', { b: 'q', a: 1 }),
        );
    });

    it('caps at MAX_NODES', () => {
        const root = openRoot('users', { id: 0 });
        const filler = addRelated(
            root,
            root.nodes[0].id,
            'r',
            'in',
            Array.from({ length: 97 }, (_, i) => t('o', i)),
        );
        expect(filler.trail.nodes).toHaveLength(98);
        const r = addRelated(
            filler.trail,
            root.nodes[0].id,
            'r',
            'in',
            Array.from({ length: 5 }, (_, i) => t('p', i)),
        );
        expect(r.trail.nodes).toHaveLength(MAX_NODES);
        expect(r.added).toHaveLength(2);
        expect(r.refused).toBe(3);
    });

    it('finds the path from the root and null for unknown ids', () => {
        const root = openRoot('users', { id: 1 });
        const r0 = root.nodes[0].id;
        const a = addRelated(root, r0, 'r1', 'in', [t('orders', 5)]);
        const b = addRelated(a.trail, a.added[0], 'r2', 'in', [
            t('order_items', 9),
        ]);
        const c = addRelated(b.trail, b.added[0], 'r3', 'out', [
            t('products', 3),
        ]);
        const p = pathTo(c.trail, c.added[0])!;
        expect(p.nodes.map((n) => n.table)).toEqual([
            'users',
            'orders',
            'order_items',
            'products',
        ]);
        expect(p.edges.map((e) => e.rel)).toEqual(['r1', 'r2', 'r3']);
        expect(pathTo(c.trail, 'nope')).toBeNull();
        expect(pathTo(c.trail, r0)!.edges).toEqual([]);
        expect(select(c.trail, r0).selected).toBe(r0);
    });

    it('places nodes deterministically without collisions', () => {
        const root = openRoot('users', { id: 1 });
        const r0 = root.nodes[0].id;
        const a = addRelated(root, r0, 'r1', 'in', [
            t('orders', 1),
            t('orders', 2),
            t('orders', 3),
        ]);
        const pos = placements(a.trail);
        expect(pos.get(r0)).toEqual({ x: 0, y: 0 });
        expect([...pos.values()].slice(1)).toEqual([
            { x: 360, y: 0 },
            { x: 360, y: 330 },
            { x: 360, y: 660 },
        ]);
        const p = addRelated(a.trail, r0, 'r0', 'out', [t('teams', 1)]);
        expect(placements(p.trail).get(p.added[0])).toEqual({ x: -360, y: 0 });
        const b = addRelated(a.trail, r0, 'r2', 'in', [
            t('logs', 1),
            t('logs', 2),
        ]);
        const pos2 = placements(b.trail);
        expect(
            new Set([...pos2.values()].map((v) => `${v.x}:${v.y}`)).size,
        ).toBe(pos2.size);
        expect(pos2.get(b.added[0])).toEqual({ x: 360, y: 990 });
        expect(placements(structuredClone(b.trail))).toEqual(pos2);
    });

    it('ignores an unknown source and counts duplicate targets once', () => {
        const root = openRoot('users', { id: 1 });
        const bad = addRelated(root, 'ghost', 'r', 'in', [t('orders', 1)]);
        expect(bad.trail).toEqual(root);
        expect(bad.added).toEqual([]);
        expect(bad.refused).toBe(0);
        const dup = addRelated(root, root.nodes[0].id, 'r', 'in', [
            t('orders', 1),
            t('orders', 1),
        ]);
        expect(dup.trail.nodes).toHaveLength(2);
        expect(dup.trail.edges).toHaveLength(1);
        expect(dup.added).toHaveLength(1);
    });
});
