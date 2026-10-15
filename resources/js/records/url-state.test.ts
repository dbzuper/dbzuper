import { describe, expect, it } from 'vitest';
import type { SchemaSnapshot, TableSchema } from '@/types/schema';
import { addRelated, nodeId, openRoot } from './trail';
import { decodeTrail, encodeTrail } from './url-state';

const table = (name: string, primary_key: string[]): TableSchema => ({
    name,
    kind: 'table',
    row_count: {} as never,
    size_bytes: null,
    primary_key,
    columns: [],
    indexes: [],
});
const snapshot = {
    driver: 'sqlite',
    database: 'd',
    schema: null,
    generated_at: '',
    hash: '',
    tables: [
        table('users', ['id']),
        table('order_items', ['order_id', 'line']),
        table('notes', ['id']),
    ],
    relationships: [],
} as SchemaSnapshot;
const pks = (name: string) =>
    snapshot.tables.find((x) => x.name === name)?.primary_key ?? null;
const b64 = (s: string) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(s)))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');

describe('url state', () => {
    it('round-trips composite, big-int and emoji keys', () => {
        const start = openRoot('users', { id: '9007199254740993' });
        const root = start.nodes[0].id;
        const a = addRelated(start, root, 'r1', 'in', [
            {
                table: 'order_items',
                key: { line: 2, order_id: 'it\'s "q" \u{1F600}' },
            },
            { table: 'notes', key: { id: 5 } },
        ]);
        const trail = { ...a.trail, selected: a.added[1] };
        const out = decodeTrail(encodeTrail(trail, pks), snapshot)!;
        expect(out.dropped).toBe(0);
        expect(out.trail.nodes.map((n) => n.id)).toEqual(
            trail.nodes.map((n) => n.id),
        );
        expect(out.trail.nodes[1].key).toEqual({
            order_id: 'it\'s "q" \u{1F600}',
            line: 2,
        });
        expect(out.trail.edges).toEqual(trail.edges);
        expect(out.trail.selected).toBe(nodeId('notes', { id: 5 }));
    });

    it('returns null for malformed or oversized params', () => {
        expect(decodeTrail('!!!', snapshot)).toBeNull();
        expect(decodeTrail('', snapshot)).toBeNull();
        expect(decodeTrail(b64('{"v":2}'), snapshot)).toBeNull();
        expect(
            decodeTrail(
                b64('{"v":1,"n":[["users",[{"a":1}]]],"e":[],"s":-1}'),
                snapshot,
            ),
        ).toBeNull();
        expect(
            decodeTrail(
                b64('{"v":1,"n":[["users",[1]]],"e":[[0,5,"r","in"]],"s":-1}'),
                snapshot,
            ),
        ).toBeNull();
        expect(decodeTrail('A'.repeat(16 * 1024 + 1), snapshot)).toBeNull();
    });

    it('drops unknown tables and wrong arity, with their edges', () => {
        const p = b64(
            JSON.stringify({
                v: 1,
                n: [
                    ['users', [1]],
                    ['ghost', [1]],
                    ['order_items', [1]],
                    ['notes', [2]],
                ],
                e: [
                    [0, 1, 'r', 'in'],
                    [0, 2, 'r', 'in'],
                    [0, 3, 'r', 'in'],
                ],
                s: 1,
            }),
        );
        const out = decodeTrail(p, snapshot)!;
        expect(out.dropped).toBe(2);
        expect(out.trail.nodes.map((n) => n.table)).toEqual(['users', 'notes']);
        expect(out.trail.edges).toHaveLength(1);
        expect(out.trail.selected).toBe(out.trail.nodes[0].id);
    });
});
