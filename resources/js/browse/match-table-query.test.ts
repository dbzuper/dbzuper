import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PerPage, RowFilter, SortKey } from '@/lib/workspace-api';
import type { ColumnSchema, Dialect, TableSchema } from '@/types/schema';
import { matchTableQuery } from './match-table-query';

const column = (name: string, nullable = false): ColumnSchema => ({
    name,
    type: 'text',
    type_name: 'text',
    nullable,
    default: null,
    auto_increment: false,
    comment: null,
});

const tableOf = (
    name: string,
    columns: string[],
    primaryKey: string[] = ['id'],
): TableSchema => ({
    name,
    kind: 'table',
    row_count: { count: null, kind: 'unknown' },
    size_bytes: null,
    primary_key: primaryKey,
    columns: columns.map((c) => column(c, c === 'note')),
    indexes: [
        { name: 'primary', columns: primaryKey, unique: true, primary: true },
    ],
});

const fixtureTable = tableOf('m7_sql_fixture', ['id', 'name', 'note', 'total']);
const orders = tableOf('orders', [
    'id',
    'status',
    'total',
    'customer_id',
    'note',
]);

type FixtureCase = {
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
) as Record<Dialect, FixtureCase[]>;

const DIALECTS: Dialect[] = ['sqlite', 'mysql', 'mariadb', 'pgsql'];

describe('fixture round trip (server-generated SQL)', () => {
    for (const dialect of DIALECTS) {
        it(`has fixtures for ${dialect}`, () => {
            expect(fixtures[dialect].length).toBeGreaterThan(10);
        });
        for (const c of fixtures[dialect]) {
            it(`${dialect}: ${c.sql}`, () => {
                expect(matchTableQuery(c.sql, dialect, fixtureTable)).toEqual({
                    ok: true,
                    state: {
                        filters: c.filters,
                        sort: c.sort,
                        page: c.page,
                        perPage: c.perPage,
                    },
                });
            });
        }
    }
});

const ok = (
    sql: string,
    dialect: Dialect = 'mysql',
    table: TableSchema = orders,
    schema?: string | null,
) => {
    const r = matchTableQuery(sql, dialect, table, schema);
    if (!r.ok) throw new Error(`expected fit, got: ${r.reason}`);
    return r.state;
};

const reason = (
    sql: string,
    dialect: Dialect = 'mysql',
    table: TableSchema = orders,
    schema?: string | null,
) => {
    const r = matchTableQuery(sql, dialect, table, schema);
    if (r.ok) throw new Error(`expected no fit, got ${JSON.stringify(r)}`);
    return r.reason;
};

describe('edited variants that fit', () => {
    it('SELECT * with a filter and no LIMIT keeps the page size', () => {
        expect(ok("SELECT * FROM orders WHERE status = 'paid'")).toStrictEqual({
            filters: [{ column: 'status', op: 'eq', value: 'paid' }],
            sort: [],
            page: 1,
            perPage: null,
        });
    });

    it('mixes bare and quoted identifiers, any keyword case', () => {
        expect(
            ok(
                "sElEcT `id`, status, `total`, customer_id, note fRoM `orders` wHeRe `status` = 'x' oRdEr By total DeSc LiMiT 100",
            ),
        ).toEqual({
            filters: [{ column: 'status', op: 'eq', value: 'x' }],
            sort: [{ column: 'total', direction: 'desc' }],
            page: 1,
            perPage: 100,
        });
        expect(
            ok(
                'select id, "status", total, "customer_id", note from "orders" where "note" is null',
                'pgsql',
            ).filters,
        ).toEqual([{ column: 'note', op: 'is_null' }]);
    });

    it('ignores -- and /* */ comments and one trailing semicolon', () => {
        expect(
            ok(
                "-- lead\nSELECT * /* all */ FROM orders -- tail\nWHERE status = 'paid' /* x */ ; -- done",
            ).filters,
        ).toEqual([{ column: 'status', op: 'eq', value: 'paid' }]);
        expect(ok('SELECT * FROM orders;', 'sqlite').filters).toEqual([]);
    });

    it('takes extra AND conditions, in order', () => {
        expect(
            ok("SELECT * FROM orders WHERE status = 'paid' AND total > 5")
                .filters,
        ).toEqual([
            { column: 'status', op: 'eq', value: 'paid' },
            { column: 'total', op: 'gt', value: '5' },
        ]);
    });

    it('allows parentheses around a condition', () => {
        expect(
            ok("SELECT * FROM orders WHERE (status = 'paid')").filters,
        ).toEqual([{ column: 'status', op: 'eq', value: 'paid' }]);
        expect(
            ok(
                "SELECT * FROM orders WHERE ((status = 'paid')) AND (total >= 1.5)",
            ).filters,
        ).toEqual([
            { column: 'status', op: 'eq', value: 'paid' },
            { column: 'total', op: 'gte', value: '1.5' },
        ]);
    });

    it('maps every comparison operator', () => {
        const ops = [
            ['=', 'eq'],
            ['<>', 'neq'],
            ['!=', 'neq'],
            ['<', 'lt'],
            ['<=', 'lte'],
            ['>', 'gt'],
            ['>=', 'gte'],
        ];
        for (const [sqlOp, op] of ops) {
            expect(
                ok(`SELECT * FROM orders WHERE total ${sqlOp} 10.5`, 'sqlite')
                    .filters,
            ).toEqual([{ column: 'total', op, value: '10.5' }]);
        }
    });

    it('numbers and strings become the same filter value', () => {
        expect(ok('SELECT * FROM orders WHERE total = 10.5').filters).toEqual(
            ok("SELECT * FROM orders WHERE total = '10.5'").filters,
        );
        expect(
            ok('SELECT * FROM orders WHERE total > -3', 'sqlite').filters,
        ).toEqual([{ column: 'total', op: 'gt', value: '-3' }]);
    });

    it('TRUE / FALSE become the engine value', () => {
        expect(
            ok('SELECT * FROM orders WHERE status = TRUE', 'pgsql').filters,
        ).toEqual([{ column: 'status', op: 'eq', value: 'true' }]);
        expect(
            ok('SELECT * FROM orders WHERE status <> false', 'pgsql').filters,
        ).toEqual([{ column: 'status', op: 'neq', value: 'false' }]);
        // MySQL/MariaDB/SQLite define TRUE as 1; the server binds a string, so '1' keeps the meaning.
        expect(
            ok('SELECT * FROM orders WHERE status = TRUE', 'mysql').filters,
        ).toEqual([{ column: 'status', op: 'eq', value: '1' }]);
        expect(
            ok('SELECT * FROM orders WHERE status = FALSE', 'sqlite').filters,
        ).toEqual([{ column: 'status', op: 'eq', value: '0' }]);
    });

    it('decodes string escapes per engine', () => {
        expect(
            ok("SELECT * FROM orders WHERE note = 'it''s'", 'pgsql').filters[0]
                .value,
        ).toBe("it's");
        expect(
            ok("SELECT * FROM orders WHERE note = 'a\\nb\\\\c\\'d''e'", 'mysql')
                .filters[0].value,
        ).toBe("a\nb\\c'd'e");
        expect(
            ok("SELECT * FROM orders WHERE note = 'a\\nb'", 'sqlite').filters[0]
                .value,
        ).toBe('a\\nb');
    });

    it('MySQL LIMIT offset, count', () => {
        expect(ok('SELECT * FROM orders LIMIT 100, 50')).toEqual({
            filters: [],
            sort: [],
            page: 3,
            perPage: 50,
        });
        expect(ok('SELECT * FROM orders LIMIT 0, 500', 'mariadb').page).toBe(1);
    });

    it('LIMIT n OFFSET m on every engine', () => {
        for (const d of DIALECTS) {
            expect(ok('SELECT * FROM orders LIMIT 100 OFFSET 200', d)).toEqual({
                filters: [],
                sort: [],
                page: 3,
                perPage: 100,
            });
        }
    });

    it('PostgreSQL ILIKE with ::text or CAST or bare column', () => {
        expect(
            ok(`SELECT * FROM orders WHERE "note"::text ILIKE '%x%'`, 'pgsql')
                .filters,
        ).toEqual([{ column: 'note', op: 'contains', value: 'x' }]);
        expect(
            ok(
                `SELECT * FROM orders WHERE cast(note as text) ilike 'ab%'`,
                'pgsql',
            ).filters,
        ).toEqual([{ column: 'note', op: 'starts_with', value: 'ab' }]);
        expect(
            ok(`SELECT * FROM orders WHERE note ILIKE '%z'`, 'pgsql').filters,
        ).toEqual([{ column: 'note', op: 'ends_with', value: 'z' }]);
    });

    it('LIKE escapes: default backslash on MySQL, explicit ESCAPE anywhere', () => {
        expect(
            ok("SELECT * FROM orders WHERE note LIKE '%5\\%%'", 'mysql')
                .filters,
        ).toEqual([{ column: 'note', op: 'contains', value: '5%' }]);
        expect(
            ok(
                "SELECT * FROM orders WHERE note LIKE 'a#_b%' ESCAPE '#'",
                'sqlite',
            ).filters,
        ).toEqual([{ column: 'note', op: 'starts_with', value: 'a_b' }]);
    });

    it('drops the trailing ascending primary-key tie-breaker', () => {
        expect(
            ok('SELECT * FROM orders ORDER BY total DESC, "id" ASC', 'pgsql')
                .sort,
        ).toEqual([{ column: 'total', direction: 'desc' }]);
        expect(ok('SELECT * FROM orders ORDER BY id', 'sqlite').sort).toEqual(
            [],
        );
        // A descending primary key is a real sort key.
        expect(ok('SELECT * FROM orders ORDER BY id DESC').sort).toEqual([
            { column: 'id', direction: 'desc' },
        ]);
    });

    it('schema-qualified table on PostgreSQL when it is the snapshot schema', () => {
        expect(
            ok('SELECT * FROM public.orders', 'pgsql', orders, 'public'),
        ).toEqual({ filters: [], sort: [], page: 1, perPage: null });
        expect(
            ok('SELECT * FROM "public"."orders"', 'pgsql', orders, 'public')
                .page,
        ).toBe(1);
    });

    it('bare names fall back to a case-insensitive match; PostgreSQL folds bare names', () => {
        expect(
            ok("SELECT * FROM ORDERS WHERE Status = 'x'", 'mysql').filters,
        ).toEqual([{ column: 'status', op: 'eq', value: 'x' }]);
        expect(
            ok("SELECT * FROM ORDERS WHERE STATUS = 'x'", 'pgsql').filters,
        ).toEqual([{ column: 'status', op: 'eq', value: 'x' }]);
    });
});

describe('near-misses that do not fit', () => {
    const cases: [string, string, Dialect?][] = [
        [
            "SELECT * FROM orders WHERE status = 'a' OR status = 'b'",
            "`OR` can't be expressed as table filters",
        ],
        [
            "SELECT * FROM orders WHERE NOT status = 'x'",
            "`NOT` can't be expressed as table filters",
        ],
        [
            "SELECT * FROM orders WHERE note NOT LIKE '%x%'",
            "`NOT` can't be expressed as table filters",
        ],
        [
            "SELECT * FROM orders WHERE lower(status) = 'a'",
            'uses a function: `lower(…)`',
        ],
        [
            'SELECT * FROM orders JOIN users ON users.id = orders.customer_id',
            'joins another table',
        ],
        [
            'SELECT * FROM orders LEFT JOIN users ON users.id = orders.customer_id',
            'joins another table',
        ],
        ['SELECT * FROM orders, users', 'joins another table'],
        [
            'SELECT * FROM orders WHERE id IN (SELECT order_id FROM refunds)',
            'a subquery',
        ],
        ['SELECT * FROM (SELECT * FROM orders) o', 'a subquery'],
        ['SELECT * FROM orders GROUP BY status', '`GROUP BY`'],
        ['SELECT DISTINCT * FROM orders', '`DISTINCT`'],
        ['SELECT id FROM orders', 'selects only some columns'],
        ['SELECT * FROM users', 'reads a different table: `users`'],
        [
            'SELECT * FROM orders LIMIT 37',
            "LIMIT 37 isn't a page size: 50, 100, 500 or 1000",
        ],
        [
            'SELECT * FROM orders LIMIT 50 OFFSET 20',
            "OFFSET 20 isn't a multiple of the page size 50",
        ],
        [
            'SELECT * FROM orders LIMIT 20, 50',
            "OFFSET 20 isn't a multiple of the page size 50",
        ],
        [
            "SELECT * FROM orders WHERE colour = 'red'",
            'unknown column `colour`',
        ],
        [
            'SELECT id, status, total, customer_id, note, colour FROM orders',
            'unknown column `colour`',
        ],
        [
            'SELECT * FROM orders; SELECT * FROM orders',
            'more than one statement',
        ],
        ['SELECT * FROM orders;;', 'more than one statement'],
        ["UPDATE orders SET status = 'x'", 'not a SELECT'],
        ['', 'not a SELECT'],
        [
            "SELECT * FROM orders WHERE note LIKE 'a%b'",
            'wildcards in the middle of a pattern',
        ],
        [
            "SELECT * FROM orders WHERE note LIKE '%a_b%'",
            'wildcards in the middle of a pattern',
        ],
        [
            "SELECT * FROM orders WHERE note LIKE '%x%'",
            'LIKE is case-sensitive on PostgreSQL; use ILIKE',
            'pgsql',
        ],
        [
            "SELECT * FROM orders WHERE note ILIKE '%x%'",
            'ILIKE is PostgreSQL only',
            'mysql',
        ],
        [
            'SELECT * FROM orders ORDER BY status, total, customer_id, note',
            'more than 3 sort columns',
        ],
        [
            'SELECT * FROM orders WHERE status = NULL',
            'compares with `NULL`; use `IS NULL`',
        ],
    ];
    for (const [sql, why, dialect] of cases) {
        it(`${dialect ?? 'mysql'}: ${sql}`, () => {
            expect(reason(sql, dialect ?? 'mysql')).toBe(why);
        });
    }

    it('more than 20 conditions', () => {
        const conds = Array.from({ length: 21 }, (_, i) => `total <> ${i}`);
        expect(
            reason(`SELECT * FROM orders WHERE ${conds.join(' AND ')}`),
        ).toBe('more than 20 conditions');
        expect(
            ok(`SELECT * FROM orders WHERE ${conds.slice(1).join(' AND ')}`)
                .filters,
        ).toHaveLength(20);
    });
});

describe('fails closed on anything else', () => {
    const notOk: [string, Dialect][] = [
        // MySQL executes /*! … */ comments.
        ['SELECT * FROM orders /*! WHERE total > 5 */', 'mysql'],
        ['SELECT * FROM orders WHERE total > 5 /*M! OR 1 = 1 */', 'mariadb'],
        // MySQL null-safe equality and adjacent-string concatenation.
        ['SELECT * FROM orders WHERE total <=> 5', 'mysql'],
        ["SELECT * FROM orders WHERE note = 'a' 'b'", 'mysql'],
        // Split operators, unknown operators.
        ['SELECT * FROM orders WHERE total < = 5', 'mysql'],
        ['SELECT * FROM orders WHERE total == 5', 'sqlite'],
        ["SELECT * FROM orders WHERE note ~ 'x'", 'pgsql'],
        ['SELECT * FROM orders WHERE total + 1 > 5', 'mysql'],
        ['SELECT * FROM orders WHERE total = 1e5', 'mysql'],
        ['SELECT * FROM orders WHERE total = - -5', 'mysql'],
        ['SELECT * FROM orders WHERE total !=-5', 'pgsql'],
        // Prefixed / other literal forms.
        ["SELECT * FROM orders WHERE note = E'a\\nb'", 'pgsql'],
        ["SELECT * FROM orders WHERE note = _utf8mb4'x'", 'mysql'],
        ['SELECT * FROM orders WHERE note = "x"', 'mysql'],
        ['SELECT * FROM orders WHERE note = $$x$$', 'pgsql'],
        ["SELECT * FROM orders WHERE note = 'x' COLLATE utf8mb4_bin", 'mysql'],
        // Unterminated tokens.
        ["SELECT * FROM orders WHERE note = 'abc", 'sqlite'],
        ["SELECT * FROM orders WHERE note = 'abc''", 'sqlite'],
        ['SELECT * FROM "orders WHERE 1', 'pgsql'],
        ['SELECT * FROM orders /* open', 'sqlite'],
        // Wrong identifier quoting for the engine.
        ['SELECT * FROM `orders`', 'pgsql'],
        ['SELECT * FROM [orders]', 'sqlite'],
        ['SELECT * FROM "orders"', 'mysql'],
        // Shapes outside the grammar.
        ['SELECT * FROM orders o', 'mysql'],
        ['SELECT * FROM orders AS o', 'mysql'],
        ['SELECT orders.* FROM orders', 'mysql'],
        ['SELECT *, id FROM orders', 'mysql'],
        [
            'SELECT id, id, status, total, customer_id, note FROM orders',
            'mysql',
        ],
        [
            'SELECT id AS i, status, total, customer_id, note FROM orders',
            'mysql',
        ],
        ['SELECT * FROM orders WHERE orders.total > 5', 'mysql'],
        ['SELECT * FROM orders WHERE total BETWEEN 1 AND 5', 'mysql'],
        ['SELECT * FROM orders WHERE total IN (1, 2)', 'mysql'],
        ['SELECT * FROM orders WHERE total = status', 'mysql'],
        ['SELECT * FROM orders WHERE note IS TRUE', 'mysql'],
        ['SELECT * FROM orders WHERE note IS DISTINCT FROM NULL', 'pgsql'],
        ['SELECT * FROM orders WHERE (total > 1 OR total < 0)', 'mysql'],
        ['SELECT * FROM orders WHERE', 'mysql'],
        ['SELECT * FROM orders WHERE total > 1 AND', 'mysql'],
        ["SELECT * FROM orders WHERE note LIKE 'abc'", 'mysql'],
        ["SELECT * FROM orders WHERE note LIKE '%a!b%' ESCAPE '!'", 'mysql'],
        ["SELECT * FROM orders WHERE note LIKE '%a%' ESCAPE '!!'", 'mysql'],
        ["SELECT * FROM orders WHERE note LIKE BINARY '%a%'", 'mysql'],
        ["SELECT * FROM orders WHERE CAST(note AS TEXT) = 'a'", 'pgsql'],
        ["SELECT * FROM orders WHERE note::varchar ILIKE '%a%'", 'pgsql'],
        ["SELECT * FROM orders WHERE note::text = 'a'", 'pgsql'],
        ['SELECT * FROM orders ORDER BY 1', 'mysql'],
        ['SELECT * FROM orders ORDER BY total NULLS FIRST', 'pgsql'],
        ['SELECT * FROM orders ORDER BY total, total DESC', 'mysql'],
        ['SELECT * FROM orders HAVING total > 1', 'mysql'],
        ['SELECT * FROM orders UNION SELECT * FROM orders', 'mysql'],
        ['SELECT * FROM orders LIMIT 50 FOR UPDATE', 'mysql'],
        ['SELECT * FROM orders FOR UPDATE', 'pgsql'],
        ['SELECT * FROM orders LIMIT ALL', 'pgsql'],
        ['SELECT * FROM orders OFFSET 50', 'pgsql'],
        ['SELECT * FROM orders LIMIT 100, 50', 'sqlite'],
        ['SELECT * FROM orders LIMIT 100, 50', 'pgsql'],
        ['SELECT * FROM orders LIMIT 50.0', 'mysql'],
        [
            'SELECT * FROM orders LIMIT 50 OFFSET 99999999999999999999950',
            'mysql',
        ],
        ['WITH x AS (SELECT 1) SELECT * FROM orders', 'pgsql'],
        ['EXPLAIN SELECT * FROM orders', 'mysql'],
        ['(SELECT * FROM orders)', 'mysql'],
    ];
    for (const [sql, dialect] of notOk) {
        it(`${dialect}: ${sql}`, () => {
            expect(matchTableQuery(sql, dialect, orders).ok).toBe(false);
        });
    }

    it('refuses what the server request validation would refuse', () => {
        expect(reason("SELECT * FROM orders WHERE note = ''")).toBe(
            'compares with an empty string',
        );
        expect(
            reason(`SELECT * FROM orders WHERE note = '${'x'.repeat(1001)}'`),
        ).toBe('a value longer than 1000 characters');
        expect(
            ok(`SELECT * FROM orders WHERE note = '${'x'.repeat(1000)}'`)
                .filters,
        ).toHaveLength(1);
        expect(reason("SELECT * FROM orders WHERE note = 'a\\0b'")).toBe(
            'a value with a NUL character',
        );
        expect(
            reason("SELECT * FROM orders WHERE note LIKE '%a\\0b%'", 'mysql'),
        ).toBe('a value with a NUL character');
        expect(reason('SELECT * FROM orders LIMIT 1000 OFFSET 100000000')).toBe(
            'page 100001 is past the last page a table can show (100000)',
        );
        expect(ok('SELECT * FROM orders LIMIT 1000 OFFSET 99999000').page).toBe(
            100000,
        );
        // An empty LIKE value is fine: the pattern still matches every non-NULL value.
        expect(
            ok("SELECT * FROM orders WHERE note LIKE '%%'", 'sqlite').filters,
        ).toEqual([{ column: 'note', op: 'contains', value: '' }]);
    });

    it('rejects a schema that is not the snapshot schema', () => {
        expect(
            reason('SELECT * FROM other.orders', 'pgsql', orders, 'public'),
        ).toBe('reads a different table: `other.orders`');
        expect(reason('SELECT * FROM shop.orders', 'mysql', orders, null)).toBe(
            'reads a different table: `shop.orders`',
        );
    });

    it('PostgreSQL bare names fold to lower case before matching', () => {
        const mixed = tableOf('Orders', ['id', 'Status']);
        // PostgreSQL reads bare Orders as orders, which is not "Orders".
        expect(matchTableQuery('SELECT * FROM Orders', 'pgsql', mixed).ok).toBe(
            false,
        );
        expect(
            matchTableQuery(
                `SELECT * FROM "Orders" WHERE "Status" = 'x'`,
                'pgsql',
                mixed,
            ).ok,
        ).toBe(true);
    });

    it('a bare name matching several columns case-insensitively is ambiguous', () => {
        const twin = tableOf('t', ['id', 'Name', 'NAME']);
        expect(reason("SELECT * FROM t WHERE name = 'x'", 'sqlite', twin)).toBe(
            'unknown column `name`',
        );
    });
});
