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
    sql: string;
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
        d: ['date', 'date'],
        ts: ['datetime', 'datetime'],
    },
    mariadb: {
        id: ['int', 'int(11)'],
        name: ['varchar', 'varchar(255)'],
        note: ['text', 'text'],
        total: ['decimal', 'decimal(10,2)'],
        d: ['date', 'date'],
        ts: ['datetime', 'datetime'],
    },
    pgsql: {
        id: ['int4', 'integer'],
        name: ['varchar', 'character varying(255)'],
        note: ['text', 'text'],
        total: ['numeric', 'numeric(10,2)'],
        d: ['date', 'date'],
        ts: ['timestamp', 'timestamp(0) without time zone'],
    },
    sqlite: {
        id: ['integer', 'integer'],
        name: ['varchar', 'varchar'],
        note: ['text', 'text'],
        total: ['numeric', 'numeric'],
        d: ['date', 'date'],
        ts: ['datetime', 'datetime'],
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

/** The WHERE clause's conditions, or '' without one. */
const whereOf = (sql: string) =>
    /\swhere\s(.*?)(?:\sorder by\s|\slimit\s)/i.exec(sql)?.[1] ?? '';

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
                const sql = buildTableSql(
                    dialect,
                    'm7_sql_fixture',
                    state,
                    tableFor(dialect).columns,
                );
                expect(
                    matchTableQuery(sql, dialect, tableFor(dialect)),
                    sql,
                ).toEqual({ ok: true, state });
                // The same conditions as the server wrote (it joins them with a lower-case `and`).
                expect(whereOf(sql).toLowerCase(), sql).toBe(
                    whereOf(c.sql).toLowerCase(),
                );
            }
        });

    it('builds a plain first page without OFFSET', () => {
        expect(
            buildTableSql(
                'mysql',
                'orders',
                {
                    filters: [],
                    sort: [],
                    page: 1,
                    perPage: 100,
                },
                [],
            ),
        ).toBe('SELECT * FROM `orders` LIMIT 100');
    });

    it('builds filters, sort and page', () => {
        expect(
            buildTableSql(
                'pgsql',
                'orders',
                {
                    filters: [
                        { column: 'status', op: 'eq', value: "O'Brien" },
                        { column: 'note', op: 'contains', value: '50%' },
                    ],
                    sort: [{ column: 'total', direction: 'desc' }],
                    page: 3,
                    perPage: 50,
                },
                [],
            ),
        ).toBe(
            `SELECT * FROM "orders" WHERE "status" = 'O''Brien' AND CAST("note" AS TEXT) ILIKE '%50!%%' ESCAPE '!' ORDER BY "total" DESC LIMIT 50 OFFSET 100`,
        );
    });

    it('builds the date operators in the server shapes', () => {
        const events = [
            { name: 'd', type_name: 'date' },
            { name: 'ts', type_name: 'datetime' },
        ];
        const where = (filters: RowFilter[]) =>
            buildTableSql(
                'mysql',
                'events',
                {
                    filters,
                    sort: [],
                    page: 1,
                    perPage: 50,
                },
                events,
            )
                .replace('SELECT * FROM `events` WHERE ', '')
                .replace(' LIMIT 50', '');
        expect(where([{ column: 'ts', op: 'on', value: '2026-12-31' }])).toBe(
            "`ts` >= '2026-12-31' AND `ts` < '2027-01-01'",
        );
        expect(
            where([{ column: 'ts', op: 'after', value: '2026-10-31' }]),
        ).toBe("`ts` >= '2026-11-01'");
        expect(
            where([
                { column: 'ts', op: 'after', value: '2026-10-31 12:00:00' },
            ]),
        ).toBe("`ts` > '2026-10-31 12:00:00'");
        expect(
            where([
                {
                    column: 'd',
                    op: 'between',
                    value: '2026-10-01',
                    to: '2026-10-31',
                },
            ]),
        ).toBe("`d` BETWEEN '2026-10-01' AND '2026-10-31'");
        expect(
            where([
                {
                    column: 'ts',
                    op: 'between',
                    value: '2026-10-01',
                    to: '2026-10-31',
                },
            ]),
        ).toBe("`ts` >= '2026-10-01' AND `ts` < '2026-11-01'");
        expect(
            where([
                {
                    column: 'ts',
                    op: 'between',
                    value: '2026-10-01 10:00:00',
                    to: '2026-10-15',
                },
            ]),
        ).toBe("`ts` >= '2026-10-01 10:00:00' AND `ts` < '2026-10-16'");
        expect(
            where([
                {
                    column: 'ts',
                    op: 'between',
                    value: '2026-10-01',
                    to: '2026-10-15 18:30:00',
                },
            ]),
        ).toBe("`ts` >= '2026-10-01' AND `ts` <= '2026-10-15 18:30:00'");
        expect(
            where([
                {
                    column: 'ts',
                    op: 'between',
                    value: '2026-10-01 10:00:00',
                    to: '2026-10-15 18:30:00',
                },
            ]),
        ).toBe("`ts` BETWEEN '2026-10-01 10:00:00' AND '2026-10-15 18:30:00'");
    });

    it('round-trips a one-day range on a date column', () => {
        const state = {
            filters: [
                {
                    column: 'd',
                    op: 'between',
                    value: '2026-10-31',
                    to: '2026-10-31',
                } satisfies RowFilter,
            ],
            sort: [],
            page: 1,
            perPage: 50 as const,
        };
        for (const dialect of [
            'sqlite',
            'mysql',
            'mariadb',
            'pgsql',
        ] as const) {
            const table = tableFor(dialect);
            const sql = buildTableSql(
                dialect,
                'm7_sql_fixture',
                state,
                table.columns,
            );
            expect(whereOf(sql)).toContain(
                "BETWEEN '2026-10-31' AND '2026-10-31'",
            );
            expect(matchTableQuery(sql, dialect, table), sql).toEqual({
                ok: true,
                state,
            });
        }
    });
});
