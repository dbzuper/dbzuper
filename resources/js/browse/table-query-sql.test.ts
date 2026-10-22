import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PerPage, RowFilter, SortKey } from '@/lib/workspace-api';
import type { ColumnSchema, Dialect, TableSchema } from '@/types/schema';
import { matchTableQuery } from './match-table-query';
import { buildTableSql } from './table-query-sql';

type Case = {
    filters: RowFilter[];
    sort: SortKey[];
    page: number;
    perPage: PerPage;
};
const fixtures = JSON.parse(
    readFileSync(
        resolve(
            process.cwd(),
            'resources/js/browse/__fixtures__/generated-sql.json',
        ),
        'utf8',
    ),
) as Record<Dialect, Case[]>;

const TYPES: Record<Dialect, Record<string, [string, string]>> = {
    mysql: {
        id: ['int', 'int'],
        name: ['varchar', 'varchar(255)'],
        note: ['text', 'text'],
        total: ['decimal', 'decimal(10,2)'],
    },
    mariadb: {
        id: ['int', 'int(11)'],
        name: ['varchar', 'varchar(255)'],
        note: ['text', 'text'],
        total: ['decimal', 'decimal(10,2)'],
    },
    pgsql: {
        id: ['int4', 'integer'],
        name: ['varchar', 'character varying(255)'],
        note: ['text', 'text'],
        total: ['numeric', 'numeric(10,2)'],
    },
    sqlite: {
        id: ['integer', 'integer'],
        name: ['varchar', 'varchar'],
        note: ['text', 'text'],
        total: ['numeric', 'numeric'],
    },
};

const tableFor = (dialect: Dialect): TableSchema => ({
    name: 'm7_sql_fixture',
    kind: 'table',
    row_count: { count: null, kind: 'unknown' },
    size_bytes: null,
    primary_key: ['id'],
    columns: Object.entries(TYPES[dialect]).map(
        ([name, [typeName, type]]): ColumnSchema => ({
            name,
            type,
            type_name: typeName,
            nullable: name === 'note',
            default: null,
            auto_increment: false,
            comment: null,
        }),
    ),
    indexes: [
        { name: 'primary', columns: ['id'], unique: true, primary: true },
    ],
});

describe('buildTableSql', () => {
    for (const dialect of ['sqlite', 'mysql', 'mariadb', 'pgsql'] as const)
        it(`maps back to the same state for every server fixture on ${dialect}`, () => {
            for (const c of fixtures[dialect]) {
                const state = {
                    filters: c.filters,
                    sort: c.sort,
                    page: c.page,
                    perPage: c.perPage,
                };
                const sql = buildTableSql(dialect, 'm7_sql_fixture', state);
                expect(
                    matchTableQuery(sql, dialect, tableFor(dialect)),
                    sql,
                ).toEqual({ ok: true, state });
            }
        });

    it('builds a plain first page without OFFSET', () => {
        expect(
            buildTableSql('mysql', 'orders', {
                filters: [],
                sort: [],
                page: 1,
                perPage: 100,
            }),
        ).toBe('SELECT * FROM `orders` LIMIT 100');
    });

    it('builds filters, sort and page', () => {
        expect(
            buildTableSql('pgsql', 'orders', {
                filters: [
                    { column: 'status', op: 'eq', value: "O'Brien" },
                    { column: 'note', op: 'contains', value: '50%' },
                ],
                sort: [{ column: 'total', direction: 'desc' }],
                page: 3,
                perPage: 50,
            }),
        ).toBe(
            `SELECT * FROM "orders" WHERE "status" = 'O''Brien' AND CAST("note" AS TEXT) ILIKE '%50!%%' ESCAPE '!' ORDER BY "total" DESC LIMIT 50 OFFSET 100`,
        );
    });
});
