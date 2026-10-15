import { describe, expect, it } from 'vitest';
import type {
    RelationshipSchema,
    SchemaSnapshot,
    TableSchema,
} from '@/types/schema';
import { addRelated, openRoot } from './trail';
import { buildTrailSql } from './trail-sql';

const col = (name: string, type = 'int') =>
    ({ name, type, nullable: false, default: null }) as never;
const table = (
    name: string,
    primary_key: string[],
    types: Record<string, string> = {},
): TableSchema => ({
    name,
    kind: 'table',
    row_count: {} as never,
    size_bytes: null,
    primary_key,
    columns: primary_key.map((k) => col(k, types[k])),
    indexes: [],
});
const rel = (
    id: string,
    from_table: string,
    from_columns: string[],
    to_table: string,
    to_columns: string[],
): RelationshipSchema => ({
    id,
    from_table,
    from_columns,
    to_table,
    to_columns,
    inferred: false,
    confidence: 1,
    name: null,
});

const s = {
    driver: 'sqlite',
    database: 'd',
    schema: null,
    generated_at: '',
    hash: '',
    tables: [
        table('users', ['id']),
        table('orders', ['id']),
        table('order_items', ['id']),
        table('products', ['product_id', 'tag']),
        table('categories', ['id']),
        table('flags', ['on'], { on: 'boolean' }),
    ],
    relationships: [
        rel('o', 'orders', ['user_id'], 'users', ['id']),
        rel('i', 'order_items', ['order_id'], 'orders', ['id']),
        rel('c', 'categories', ['parent_id'], 'categories', ['id']),
    ],
} as SchemaSnapshot;

function chain() {
    const root = openRoot('users', { id: 2 });
    const a = addRelated(root, root.nodes[0].id, 'o', 'in', [
        { table: 'orders', key: { id: 7 } },
    ]);
    return addRelated(a.trail, a.added[0], 'i', 'in', [
        { table: 'order_items', key: { id: 9 } },
    ]);
}

describe('buildTrailSql', () => {
    it('joins a parent-to-child path', () => {
        const b = chain();
        expect(buildTrailSql(b.trail, b.added[0], s, 'sqlite')).toBe(
            'SELECT t2.*\nFROM "users" AS t0\nJOIN "orders" AS t1 ON t1."user_id" = t0."id"\nJOIN "order_items" AS t2 ON t2."order_id" = t1."id"\nWHERE t0."id" = 2\nLIMIT 100;',
        );
    });

    it('uses backticks for mysql and escapes composite string literals', () => {
        const root = openRoot('products', { tag: "it's \\ x", product_id: 1 });
        const sql = buildTrailSql(root, root.nodes[0].id, s, 'sqlite')!;
        expect(sql).toContain(
            `WHERE t0."product_id" = 1 AND t0."tag" = 'it''s \\ x'`,
        );
        const my = buildTrailSql(root, root.nodes[0].id, s, 'mysql')!;
        expect(my).toContain(
            "WHERE t0.`product_id` = 1 AND t0.`tag` = 'it''s \\\\ x'",
        );
    });

    it('handles a self-referential child to parent hop', () => {
        const root = openRoot('categories', { id: 5 });
        const a = addRelated(root, root.nodes[0].id, 'c', 'out', [
            { table: 'categories', key: { id: 2 } },
        ]);
        expect(buildTrailSql(a.trail, a.added[0], s, 'pgsql')).toContain(
            'JOIN "categories" AS t1 ON t1."id" = t0."parent_id"',
        );
    });

    it('emits boolean literals per dialect and big ints bare', () => {
        const root = openRoot('flags', { on: 'true' });
        expect(buildTrailSql(root, root.nodes[0].id, s, 'pgsql')).toContain(
            '= TRUE',
        );
        expect(buildTrailSql(root, root.nodes[0].id, s, 'mysql')).toContain(
            '= 1',
        );
        const big = openRoot('users', { id: '9007199254740993' });
        expect(buildTrailSql(big, big.nodes[0].id, s, 'sqlite')).toContain(
            '= 9007199254740993',
        );
    });

    it('returns null for unknown targets or relationships', () => {
        const b = chain();
        expect(buildTrailSql(b.trail, 'nope', s, 'sqlite')).toBeNull();
        const bad = {
            ...b.trail,
            edges: b.trail.edges.map((e) => ({ ...e, rel: 'zzz' })),
        };
        expect(buildTrailSql(bad, b.added[0], s, 'sqlite')).toBeNull();
    });
});
