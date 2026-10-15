import { describe, expect, it } from 'vitest';
import { makeRelationship, makeTable } from './__fixtures__/snapshot';
import { generateDdl, quoteIdent } from './ddl';

describe('quoteIdent', () => {
    it('quotes and escapes per dialect', () => {
        expect(quoteIdent('a`b', 'mysql')).toBe('`a``b`');
        expect(quoteIdent('odd "name"', 'pgsql')).toBe('"odd ""name"""');
        expect(quoteIdent('régions', 'sqlite')).toBe('"régions"');
    });
});

describe('generateDdl', () => {
    const table = makeTable({
        name: 'orders',
        columns: [
            {
                name: 'id',
                type: 'bigint',
                type_name: 'int8',
                nullable: false,
                default: null,
                auto_increment: true,
                comment: null,
            },
            {
                name: 'user_id',
                type: 'bigint',
                type_name: 'int8',
                nullable: false,
                default: null,
                auto_increment: false,
                comment: null,
            },
            {
                name: 'status',
                type: 'varchar(20)',
                type_name: 'varchar',
                nullable: true,
                default: "'new'",
                auto_increment: false,
                comment: null,
            },
        ],
        indexes: [
            {
                name: 'orders_pkey',
                columns: ['id'],
                unique: true,
                primary: true,
            },
            {
                name: 'orders_status_idx',
                columns: ['status'],
                unique: false,
                primary: false,
            },
        ],
    });
    const rels = [
        makeRelationship({
            from_table: 'orders',
            to_table: 'users',
            from_columns: ['user_id'],
            name: 'orders_user_fk',
        }),
        makeRelationship({
            from_table: 'orders',
            to_table: 'shops',
            from_columns: ['shop_id'],
            inferred: true,
        }),
    ];

    it('generates an approximate CREATE TABLE with keys and indexes', () => {
        expect(generateDdl(table, rels, 'pgsql')).toBe(
            [
                'CREATE TABLE "orders" (',
                '  "id" bigint NOT NULL,',
                '  "user_id" bigint NOT NULL,',
                `  "status" varchar(20) DEFAULT 'new',`,
                '  PRIMARY KEY ("id"),',
                '  CONSTRAINT "orders_user_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id")',
                ');',
                'CREATE INDEX "orders_status_idx" ON "orders" ("status");',
            ].join('\n'),
        );
    });

    it('explains views it cannot reconstruct', () => {
        expect(
            generateDdl(makeTable({ name: 'v', kind: 'view' }), [], 'pgsql'),
        ).toContain('is a view');
    });
});
