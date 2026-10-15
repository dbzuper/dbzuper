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

const snap = (tables: TableSchema[], relationships: RelationshipSchema[]) =>
    ({
        driver: 'sqlite',
        database: 'd',
        schema: null,
        generated_at: '',
        hash: '',
        tables,
        relationships,
    }) as SchemaSnapshot;

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

    it('decides bare vs quoted literals from the column type', () => {
        const t = snap(
            [
                table('texts', ['code'], { code: 'varchar(10)' }),
                table('big', ['id'], { id: 'bigint' }),
                table('money', ['amt'], { amt: 'numeric(10,2)' }),
                table('unk', ['k'], { k: 'citext' }),
                table('iv', ['v'], { v: 'interval' }),
            ],
            [],
        );
        const sql = (tb: string, key: Record<string, string>) => {
            const r = openRoot(tb, key);
            return buildTrailSql(r, r.nodes[0].id, t, 'pgsql');
        };
        expect(sql('texts', { code: '1' })).toContain(`= '1'`);
        expect(sql('texts', { code: '007' })).toContain(`= '007'`);
        expect(sql('big', { id: '9007199254740993' })).toContain(
            '= 9007199254740993',
        );
        expect(sql('money', { amt: '1.50' })).toContain('= 1.50');
        expect(sql('unk', { k: '5' })).toContain(`= '5'`);
        expect(sql('iv', { v: '5' })).toContain(`= '5'`);
    });

    it('returns null when the relationship does not connect the hop tables', () => {
        const root = openRoot('users', { id: 2 });
        const wrongDir = addRelated(root, root.nodes[0].id, 'o', 'out', [
            { table: 'orders', key: { id: 7 } },
        ]);
        expect(
            buildTrailSql(wrongDir.trail, wrongDir.added[0], s, 'sqlite'),
        ).toBeNull();
        const wrongTable = addRelated(root, root.nodes[0].id, 'i', 'in', [
            { table: 'orders', key: { id: 7 } },
        ]);
        expect(
            buildTrailSql(wrongTable.trail, wrongTable.added[0], s, 'sqlite'),
        ).toBeNull();
    });

    it('handles a self-referential parent to child hop', () => {
        const root = openRoot('categories', { id: 5 });
        const a = addRelated(root, root.nodes[0].id, 'c', 'in', [
            { table: 'categories', key: { id: 9 } },
        ]);
        expect(buildTrailSql(a.trail, a.added[0], s, 'sqlite')).toContain(
            'JOIN "categories" AS t1 ON t1."parent_id" = t0."id"',
        );
    });

    it('joins composite foreign keys with AND and backticks for mysql', () => {
        const t = snap(
            [
                table('products', ['product_id', 'tag']),
                table('variants', ['id']),
            ],
            [
                rel('v', 'variants', ['product_id', 'tag'], 'products', [
                    'product_id',
                    'tag',
                ]),
            ],
        );
        const root = openRoot('products', { product_id: 1, tag: 'a' });
        const a = addRelated(root, root.nodes[0].id, 'v', 'in', [
            { table: 'variants', key: { id: 3 } },
        ]);
        expect(buildTrailSql(a.trail, a.added[0], t, 'mysql')).toContain(
            'JOIN `variants` AS t1 ON t1.`product_id` = t0.`product_id` AND t1.`tag` = t0.`tag`',
        );
    });
});
