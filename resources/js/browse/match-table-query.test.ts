import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PerPage, RowFilter, SortKey } from '@/lib/workspace-api';
import type { ColumnSchema, Dialect, TableSchema } from '@/types/schema';
import { matchTableQuery } from './match-table-query';

const asciiLowerName = (s: string) =>
    s.replace(/[A-Z]+/g, (m) => m.toLowerCase());

type Kind = 'int' | 'varchar' | 'text' | 'decimal' | 'bool' | 'char';
/** [type_name, type] as Laravel's Schema::getColumns reports them per engine. */
const TYPES: Record<Dialect, Record<Kind, [string, string]>> = {
    mysql: {
        int: ['int', 'int'],
        varchar: ['varchar', 'varchar(255)'],
        text: ['text', 'text'],
        decimal: ['decimal', 'decimal(10,2)'],
        bool: ['tinyint', 'tinyint(1)'],
        char: ['char', 'char(5)'],
    },
    mariadb: {
        int: ['int', 'int(11)'],
        varchar: ['varchar', 'varchar(255)'],
        text: ['text', 'text'],
        decimal: ['decimal', 'decimal(10,2)'],
        bool: ['tinyint', 'tinyint(1)'],
        char: ['char', 'char(5)'],
    },
    pgsql: {
        int: ['int4', 'integer'],
        varchar: ['varchar', 'character varying(255)'],
        text: ['text', 'text'],
        decimal: ['numeric', 'numeric(10,2)'],
        bool: ['bool', 'boolean'],
        char: ['bpchar', 'character(5)'],
    },
    sqlite: {
        int: ['integer', 'integer'],
        varchar: ['varchar', 'varchar'],
        text: ['text', 'text'],
        decimal: ['numeric', 'numeric'],
        bool: ['tinyint', 'tinyint(1)'],
        char: ['varchar', 'varchar'],
    },
};

const column = (
    name: string,
    [typeName, type]: [string, string] = ['text', 'text'],
    nullable = false,
): ColumnSchema => ({
    name,
    type,
    type_name: typeName,
    nullable,
    default: null,
    auto_increment: false,
    comment: null,
});

const tableWith = (
    name: string,
    columns: ColumnSchema[],
    primaryKey: string[] = ['id'],
): TableSchema => ({
    name,
    kind: 'table',
    row_count: { count: null, kind: 'unknown' },
    size_bytes: null,
    primary_key: primaryKey,
    columns,
    indexes: [
        { name: 'primary', columns: primaryKey, unique: true, primary: true },
    ],
});

/** A table of untyped-text columns, for name-matching tests. */
const tableOf = (name: string, columns: string[]) =>
    tableWith(
        name,
        columns.map((c) => column(c)),
    );

const typed = (dialect: Dialect, name: string, spec: [string, Kind][]) =>
    tableWith(
        name,
        spec.map(([c, kind]) => column(c, TYPES[dialect][kind], c === 'note')),
    );

/** Task 1's table: id int PK, name varchar, nullable note text, total decimal. */
const fixtureTable = (dialect: Dialect) =>
    typed(dialect, 'm7_sql_fixture', [
        ['id', 'int'],
        ['name', 'varchar'],
        ['note', 'text'],
        ['total', 'decimal'],
    ]);
const ordersFor = (dialect: Dialect) =>
    typed(dialect, 'orders', [
        ['id', 'int'],
        ['status', 'varchar'],
        ['total', 'decimal'],
        ['customer_id', 'int'],
        ['note', 'text'],
        ['paid', 'bool'],
        ['code', 'char'],
    ]);
const ALL_COLUMNS = 'id, status, total, customer_id, note, paid, code';

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
                expect(
                    matchTableQuery(c.sql, dialect, fixtureTable(dialect)),
                ).toEqual({
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
    table: TableSchema = ordersFor(dialect),
    schema?: string | null,
) => {
    const r = matchTableQuery(sql, dialect, table, schema);
    if (!r.ok) throw new Error(`expected fit, got: ${r.reason}`);
    return r.state;
};

const reason = (
    sql: string,
    dialect: Dialect = 'mysql',
    table: TableSchema = ordersFor(dialect),
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
                "sElEcT `id`, status, `total`, customer_id, note, paid, `code` fRoM `orders` wHeRe `status` = 'x' oRdEr By total DeSc LiMiT 100",
            ),
        ).toEqual({
            filters: [{ column: 'status', op: 'eq', value: 'x' }],
            sort: [{ column: 'total', direction: 'desc' }],
            page: 1,
            perPage: 100,
        });
        expect(
            ok(
                'select id, "status", total, "customer_id", note, paid, "code" from "orders" where "note" is null',
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
            ok('SELECT * FROM orders WHERE paid = TRUE', 'pgsql').filters,
        ).toEqual([{ column: 'paid', op: 'eq', value: 'true' }]);
        expect(
            ok('SELECT * FROM orders WHERE paid <> false', 'pgsql').filters,
        ).toEqual([{ column: 'paid', op: 'neq', value: 'false' }]);
        // MySQL/MariaDB/SQLite define TRUE as 1; the server binds a string, so '1' keeps the meaning.
        expect(
            ok('SELECT * FROM orders WHERE paid = TRUE', 'mysql').filters,
        ).toEqual([{ column: 'paid', op: 'eq', value: '1' }]);
        expect(
            ok('SELECT * FROM orders WHERE paid = FALSE', 'sqlite').filters,
        ).toEqual([{ column: 'paid', op: 'eq', value: '0' }]);
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

    it('PostgreSQL ILIKE with ::text or CAST, or bare on a text column', () => {
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
            ok(
                'SELECT * FROM public.orders',
                'pgsql',
                ordersFor('pgsql'),
                'public',
            ),
        ).toEqual({ filters: [], sort: [], page: 1, perPage: null });
        expect(
            ok(
                'SELECT * FROM "public"."orders"',
                'pgsql',
                ordersFor('pgsql'),
                'public',
            ).page,
        ).toBe(1);
    });

    it('bare names fall back to a case-insensitive match; PostgreSQL folds bare names', () => {
        // MySQL/MariaDB columns are case-insensitive; their table names are matched exactly.
        expect(
            ok("SELECT * FROM orders WHERE Status = 'x'", 'mysql').filters,
        ).toEqual([{ column: 'status', op: 'eq', value: 'x' }]);
        expect(
            ok("SELECT * FROM ORDERS WHERE STATUS = 'x'", 'sqlite').filters,
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
            `SELECT ${ALL_COLUMNS}, colour FROM orders`,
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
        [`SELECT id, ${ALL_COLUMNS} FROM orders`, 'mysql'],
        [`SELECT id AS i, ${ALL_COLUMNS.slice(4)} FROM orders`, 'mysql'],
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
            expect(matchTableQuery(sql, dialect, ordersFor(dialect)).ok).toBe(
                false,
            );
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
            reason(
                'SELECT * FROM other.orders',
                'pgsql',
                ordersFor('pgsql'),
                'public',
            ),
        ).toBe('reads a different table: `other.orders`');
        expect(
            reason(
                'SELECT * FROM shop.orders',
                'mysql',
                ordersFor('mysql'),
                null,
            ),
        ).toBe('reads a different table: `shop.orders`');
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

describe('column types decide what a number or TRUE/FALSE means', () => {
    const NUMBER_ON_TEXT: [string, Dialect, string][] = [
        // MySQL compares a text column with a number numerically ('7abc' = 7); the server compares strings.
        [
            'status = 7',
            'mysql',
            'compares column `status` (varchar(255)) with a number',
        ],
        [
            'status = 0',
            'mariadb',
            'compares column `status` (varchar(255)) with a number',
        ],
        ['note > 10', 'mysql', 'compares column `note` (text) with a number'],
        // SQLite TEXT affinity turns 1.50 into '1.5'; the server sends '1.50'.
        [
            'note = 1.50',
            'sqlite',
            'compares column `note` (text) with a number',
        ],
        [
            'status = 05',
            'sqlite',
            'compares column `status` (varchar) with a number',
        ],
        // PostgreSQL text = integer is an error.
        ['note = 5', 'pgsql', 'compares column `note` (text) with a number'],
        [
            'code = 5',
            'pgsql',
            'compares column `code` (character(5)) with a number',
        ],
    ];
    for (const [cond, dialect, why] of NUMBER_ON_TEXT) {
        it(`${dialect}: ${cond} does not fit`, () => {
            expect(reason(`SELECT * FROM orders WHERE ${cond}`, dialect)).toBe(
                why,
            );
        });
    }

    it('SQLite untyped (BLOB affinity) columns never take a number', () => {
        const loose = tableWith('t', [
            column('id', ['integer', 'integer']),
            column('x', ['', '']),
        ]);
        expect(reason('SELECT * FROM t WHERE x = 5', 'sqlite', loose)).toBe(
            'compares column `x` (untyped) with a number',
        );
        expect(
            ok("SELECT * FROM t WHERE x = '5'", 'sqlite', loose).filters,
        ).toEqual([{ column: 'x', op: 'eq', value: '5' }]);
    });

    it('numbers fit numeric columns on every engine', () => {
        for (const d of DIALECTS) {
            expect(
                ok(
                    'SELECT * FROM orders WHERE customer_id = 7 AND total >= 1.50',
                    d,
                ).filters,
            ).toEqual([
                { column: 'customer_id', op: 'eq', value: '7' },
                { column: 'total', op: 'gte', value: '1.50' },
            ]);
        }
    });

    it('SQLite numeric affinities: INT, REAL/FLOA/DOUB, NUMERIC/DECIMAL', () => {
        const t = tableWith('t', [
            column('id', ['integer', 'integer']),
            column('a', ['bigint', 'bigint']),
            column('b', ['double', 'double']),
            column('c', ['float', 'float']),
            column('d', ['decimal', 'decimal(10,2)']),
            column('e', ['real', 'real']),
        ]);
        for (const c of ['a', 'b', 'c', 'd', 'e'])
            expect(
                ok(`SELECT * FROM t WHERE ${c} = 5`, 'sqlite', t).filters,
            ).toEqual([{ column: c, op: 'eq', value: '5' }]);
    });

    it('MySQL/MariaDB numbers stop at 15 significant digits (the server compares as double)', () => {
        const big = tableWith('t', [
            column('id', ['bigint', 'bigint unsigned']),
        ]);
        expect(
            ok('SELECT * FROM t WHERE id = 123456789012345', 'mysql', big)
                .filters,
        ).toEqual([{ column: 'id', op: 'eq', value: '123456789012345' }]);
        expect(
            reason('SELECT * FROM t WHERE id = 9007199254740993', 'mysql', big),
        ).toBe(
            'the number 9007199254740993 has more than 15 significant digits',
        );
        expect(
            reason(
                'SELECT * FROM orders WHERE total = 0.1234567890123456',
                'mariadb',
            ),
        ).toBe(
            'the number 0.1234567890123456 has more than 15 significant digits',
        );
        // PostgreSQL casts the quoted value to the column type, so long numbers stay exact.
        expect(
            ok('SELECT * FROM orders WHERE total = 0.1234567890123456', 'pgsql')
                .filters,
        ).toHaveLength(1);
    });

    it('TRUE/FALSE only against boolean columns', () => {
        expect(
            reason('SELECT * FROM orders WHERE status = TRUE', 'mysql'),
        ).toBe('compares column `status` (varchar(255)) with `TRUE`/`FALSE`');
        expect(
            reason('SELECT * FROM orders WHERE customer_id = FALSE', 'mysql'),
        ).toBe('compares column `customer_id` (int) with `TRUE`/`FALSE`');
        expect(reason('SELECT * FROM orders WHERE note = TRUE', 'pgsql')).toBe(
            'compares column `note` (text) with `TRUE`/`FALSE`',
        );
        expect(
            reason('SELECT * FROM orders WHERE status = TRUE', 'sqlite'),
        ).toBe('compares column `status` (varchar) with `TRUE`/`FALSE`');
        expect(
            ok('SELECT * FROM orders WHERE paid = true', 'mariadb').filters,
        ).toEqual([{ column: 'paid', op: 'eq', value: '1' }]);
        const pgBool = tableWith('t', [
            column('id', ['int4', 'integer']),
            column('flag', ['bool', 'boolean']),
        ]);
        expect(
            ok('SELECT * FROM t WHERE flag = FALSE', 'pgsql', pgBool).filters,
        ).toEqual([{ column: 'flag', op: 'eq', value: 'false' }]);
        const liteBool = tableWith('t', [
            column('id', ['integer', 'integer']),
            column('flag', ['boolean', 'boolean']),
        ]);
        expect(
            ok('SELECT * FROM t WHERE flag = TRUE', 'sqlite', liteBool).filters,
        ).toEqual([{ column: 'flag', op: 'eq', value: '1' }]);
    });

    it('PostgreSQL bare ILIKE only on text, varchar or citext columns', () => {
        expect(
            reason("SELECT * FROM orders WHERE code ILIKE 'ab%'", 'pgsql'),
        ).toBe('ILIKE on column `code` (character(5)) needs `CAST(… AS TEXT)`');
        expect(
            reason("SELECT * FROM orders WHERE total ILIKE '%5%'", 'pgsql'),
        ).toBe(
            'ILIKE on column `total` (numeric(10,2)) needs `CAST(… AS TEXT)`',
        );
        expect(
            ok(
                "SELECT * FROM orders WHERE CAST(code AS TEXT) ILIKE 'ab%'",
                'pgsql',
            ).filters,
        ).toEqual([{ column: 'code', op: 'starts_with', value: 'ab' }]);
        expect(
            ok("SELECT * FROM orders WHERE total::text ILIKE '%5%'", 'pgsql')
                .filters,
        ).toEqual([{ column: 'total', op: 'contains', value: '5' }]);
        expect(
            ok("SELECT * FROM orders WHERE status ILIKE '%x%'", 'pgsql')
                .filters,
        ).toEqual([{ column: 'status', op: 'contains', value: 'x' }]);
        const ci = tableWith('t', [
            column('id', ['int4', 'integer']),
            column('email', ['citext', 'citext']),
        ]);
        expect(
            ok("SELECT * FROM t WHERE email ILIKE '%@x'", 'pgsql', ci).filters,
        ).toEqual([{ column: 'email', op: 'ends_with', value: '@x' }]);
    });
});

describe('names the engine reads differently', () => {
    it('MySQL/MariaDB table names and schema qualifiers match exactly', () => {
        for (const d of ['mysql', 'mariadb'] as Dialect[]) {
            expect(reason('SELECT * FROM ORDERS', d)).toBe(
                'reads a different table: `ORDERS`',
            );
            expect(reason('SELECT * FROM `Orders`', d)).toBe(
                'reads a different table: `Orders`',
            );
            expect(
                reason('SELECT * FROM SHOP.orders', d, ordersFor(d), 'shop'),
            ).toBe('reads a different table: `SHOP.orders`');
            expect(
                ok('SELECT * FROM shop.orders', d, ordersFor(d), 'shop').page,
            ).toBe(1);
        }
    });

    const BUILT_INS: [string, Dialect][] = [
        ['current_user', 'pgsql'],
        ['user', 'pgsql'],
        ['session_user', 'pgsql'],
        ['current_role', 'pgsql'],
        ['current_date', 'pgsql'],
        ['current_time', 'pgsql'],
        ['current_timestamp', 'pgsql'],
        ['localtime', 'pgsql'],
        ['localtimestamp', 'pgsql'],
        ['CURRENT_DATE', 'sqlite'],
        ['CURRENT_TIME', 'sqlite'],
        ['CURRENT_TIMESTAMP', 'sqlite'],
        ['CURRENT_USER', 'mysql'],
        ['CURRENT_DATE', 'mysql'],
        ['CURRENT_TIME', 'mysql'],
        ['CURRENT_TIMESTAMP', 'mysql'],
        ['LOCALTIME', 'mysql'],
        ['LOCALTIMESTAMP', 'mysql'],
        ['UTC_DATE', 'mariadb'],
        ['UTC_TIME', 'mariadb'],
        ['UTC_TIMESTAMP', 'mysql'],
    ];
    for (const [word, dialect] of BUILT_INS) {
        it(`${dialect}: bare ${word} is a built-in value, not a column`, () => {
            const t = tableOf('t', ['id', asciiLowerName(word)]);
            expect(
                reason(`SELECT * FROM t WHERE ${word} = 'x'`, dialect, t),
            ).toBe(`\`${word}\` is a reserved word; quote it`);
            const q = dialect === 'pgsql' || dialect === 'sqlite' ? '"' : '`';
            expect(
                ok(
                    `SELECT * FROM t WHERE ${q}${asciiLowerName(word)}${q} = 'x'`,
                    dialect,
                    t,
                ).filters,
            ).toHaveLength(1);
        });
    }

    it('unquoted reserved words do not fit; quoted they do', () => {
        const t = tableOf('t', ['id', 'key', 'order']);
        expect(reason("SELECT * FROM t WHERE key = 'x'", 'mysql', t)).toBe(
            '`key` is a reserved word; quote it',
        );
        expect(reason("SELECT * FROM t WHERE order = 'x'", 'pgsql', t)).toBe(
            '`order` is a reserved word; quote it',
        );
        expect(reason('SELECT id, key, `order` FROM t', 'mariadb', t)).toBe(
            '`key` is a reserved word; quote it',
        );
        expect(reason('SELECT * FROM t ORDER BY order', 'sqlite', t)).toBe(
            '`order` is a reserved word; quote it',
        );
        expect(
            ok(
                "SELECT id, `key`, `order` FROM t WHERE `key` = 'x' ORDER BY `order`",
                'mysql',
                t,
            ),
        ).toEqual({
            filters: [{ column: 'key', op: 'eq', value: 'x' }],
            sort: [{ column: 'order', direction: 'asc' }],
            page: 1,
            perPage: null,
        });
    });
});

describe('numbers where the server would compare differently', () => {
    const cols = (...spec: [string, string, string][]) =>
        tableWith(
            't',
            spec.map(([name, typeName, type]) =>
                column(name, [typeName, type]),
            ),
        );

    it('PostgreSQL real/float4: the literal compares as float8, the quoted value as real', () => {
        const t = cols(
            ['id', 'int4', 'integer'],
            ['r', 'float4', 'real'],
            ['d', 'float8', 'double precision'],
        );
        expect(reason('SELECT * FROM t WHERE r = 1.1', 'pgsql', t)).toBe(
            'compares column `r` (real) with a number',
        );
        expect(reason('SELECT * FROM t WHERE r > 1', 'pgsql', t)).toBe(
            'compares column `r` (real) with a number',
        );
        expect(
            ok("SELECT * FROM t WHERE r = '1.1'", 'pgsql', t).filters,
        ).toEqual([{ column: 'r', op: 'eq', value: '1.1' }]);
        // float8 parses the literal and the quoted value to the same double.
        expect(ok('SELECT * FROM t WHERE d = 1.1', 'pgsql', t).filters).toEqual(
            [{ column: 'd', op: 'eq', value: '1.1' }],
        );
    });

    it('PostgreSQL integer columns take only whole numbers in range', () => {
        const t = cols(
            ['id', 'int4', 'integer'],
            ['s', 'int2', 'smallint'],
            ['b', 'int8', 'bigint'],
        );
        const refused: [string, string][] = [
            ['id = 1.5', "1.5 isn't a valid value for column `id` (integer)"],
            ['id > 2.5', "2.5 isn't a valid value for column `id` (integer)"],
            [
                'id = 3000000000',
                "3000000000 isn't a valid value for column `id` (integer)",
            ],
            [
                'id = 2147483648',
                "2147483648 isn't a valid value for column `id` (integer)",
            ],
            [
                'id = -2147483649',
                "-2147483649 isn't a valid value for column `id` (integer)",
            ],
            [
                's = 40000',
                "40000 isn't a valid value for column `s` (smallint)",
            ],
            [
                's = 32768',
                "32768 isn't a valid value for column `s` (smallint)",
            ],
            [
                'b = 9223372036854775808',
                "9223372036854775808 isn't a valid value for column `b` (bigint)",
            ],
            ['b = 1.0', "1.0 isn't a valid value for column `b` (bigint)"],
        ];
        for (const [cond, why] of refused)
            expect(reason(`SELECT * FROM t WHERE ${cond}`, 'pgsql', t)).toBe(
                why,
            );
        for (const cond of [
            'id = 2147483647',
            'id = -2147483648',
            's = 32767',
            's = -32768',
            'b = 9223372036854775807',
            'b = -9223372036854775808',
            'id = 007',
        ])
            expect(
                ok(`SELECT * FROM t WHERE ${cond}`, 'pgsql', t).filters,
            ).toHaveLength(1);
    });

    it('MySQL/MariaDB DECIMAL takes numbers only up to 15 digits of precision', () => {
        for (const d of ['mysql', 'mariadb'] as Dialect[]) {
            const t = cols(
                ['id', 'int', 'int'],
                ['wide', 'decimal', 'decimal(20,10)'],
                ['n16', 'decimal', 'decimal(16,0) unsigned'],
                ['p15', 'decimal', 'decimal(15,2)'],
                ['plain', 'decimal', 'decimal'],
            );
            expect(reason('SELECT * FROM t WHERE wide = 1234567', d, t)).toBe(
                'compares column `wide` (decimal(20,10)) with a number the table view would compare differently',
            );
            expect(reason('SELECT * FROM t WHERE n16 > 5', d, t)).toBe(
                'compares column `n16` (decimal(16,0) unsigned) with a number the table view would compare differently',
            );
            expect(
                ok("SELECT * FROM t WHERE wide = '1234567'", d, t).filters,
            ).toEqual([{ column: 'wide', op: 'eq', value: '1234567' }]);
            expect(
                ok('SELECT * FROM t WHERE p15 = 1234567.25 AND plain > 3', d, t)
                    .filters,
            ).toHaveLength(2);
        }
    });

    it('MySQL/MariaDB FLOAT (single precision) takes only whole numbers; DOUBLE takes any', () => {
        const t = cols(
            ['id', 'int', 'int'],
            ['f', 'float', 'float'],
            ['d', 'double', 'double'],
        );
        expect(reason('SELECT * FROM t WHERE f = 1.1', 'mysql', t)).toBe(
            'compares column `f` (float) with a number the table view would compare differently',
        );
        expect(
            ok('SELECT * FROM t WHERE f = 2', 'mysql', t).filters,
        ).toHaveLength(1);
        expect(
            ok('SELECT * FROM t WHERE d = 1.1', 'mariadb', t).filters,
        ).toHaveLength(1);
    });

    it('SQLite REAL: the quoted value takes REAL affinity and parses like the literal', () => {
        const t = cols(['id', 'integer', 'integer'], ['r', 'real', 'real']);
        expect(
            ok('SELECT * FROM t WHERE r = 1.1', 'sqlite', t).filters,
        ).toEqual([{ column: 'r', op: 'eq', value: '1.1' }]);
        expect(
            ok('SELECT * FROM t WHERE id = 1.5', 'sqlite', t).filters,
        ).toEqual([{ column: 'id', op: 'eq', value: '1.5' }]);
    });
});

describe('values the server request would change before filtering', () => {
    // Laravel's TrimStrings + ConvertEmptyStringsToNull run on the rows request:
    // a padded value would be applied trimmed (or as NULL), not as typed.
    const TRIMMED = 'a value with leading or trailing spaces';

    it('refuses LIKE patterns whose value has leading or trailing whitespace', () => {
        for (const d of DIALECTS) {
            const like = d === 'pgsql' ? 'ILIKE' : 'LIKE';
            for (const pattern of [
                '% %',
                '%  %',
                '%x %',
                '% x%',
                ' x%',
                '%x ',
                '%​x%',
                '%x\u{FEFF}%',
                '%᠎x%',
                '% x%',
                '%x\t%',
                '%x　%',
                '%x\u{1D159}%',
            ]) {
                expect(
                    reason(
                        `SELECT * FROM orders WHERE note ${like} '${pattern}'`,
                        d,
                    ),
                ).toBe(TRIMMED);
            }
        }
    });

    it('refuses comparison values with leading or trailing whitespace', () => {
        for (const value of [' x', 'x ', ' ', '​x', 'x⁠', 'ㅤx']) {
            expect(
                reason(`SELECT * FROM orders WHERE status = '${value}'`),
            ).toBe(TRIMMED);
            expect(
                reason(`SELECT * FROM orders WHERE status <> '${value}'`),
            ).toBe(TRIMMED);
        }
    });

    it('inner whitespace and an empty LIKE value still fit', () => {
        expect(
            ok("SELECT * FROM orders WHERE note LIKE '%a b%'").filters,
        ).toEqual([{ column: 'note', op: 'contains', value: 'a b' }]);
        expect(ok("SELECT * FROM orders WHERE status = 'a​b'").filters).toEqual([
            { column: 'status', op: 'eq', value: 'a​b' },
        ]);
        expect(ok("SELECT * FROM orders WHERE note LIKE '%%'").filters).toEqual(
            [{ column: 'note', op: 'contains', value: '' }],
        );
    });
});

describe('quoted special table names', () => {
    it('matches doubled quotes inside quoted identifiers', () => {
        const pg = typed('pgsql', 'o"rders', [['id', 'int']]);
        expect(ok('SELECT * FROM "o""rders"', 'pgsql', pg).page).toBe(1);
        expect(reason('SELECT * FROM "o""rder"', 'pgsql', pg)).toBe(
            'reads a different table: `o"rder`',
        );
        const sq = typed('sqlite', 'o"rders', [['id', 'int']]);
        expect(ok('SELECT * FROM "o""rders"', 'sqlite', sq).page).toBe(1);
        for (const d of ['mysql', 'mariadb'] as Dialect[]) {
            const my = typed(d, 'o`rders', [['id', 'int']]);
            expect(ok('SELECT * FROM `o``rders`', d, my).page).toBe(1);
            expect(reason('SELECT * FROM `o``rder`', d, my)).toBe(
                'reads a different table: `o`rder`',
            );
        }
    });

    it('matches non-ASCII table names', () => {
        for (const d of DIALECTS) {
            const t = typed(d, 'bestellüngen', [['id', 'int']]);
            const q = d === 'mysql' || d === 'mariadb' ? '`' : '"';
            expect(ok(`SELECT * FROM ${q}bestellüngen${q}`, d, t).page).toBe(1);
            expect(reason(`SELECT * FROM ${q}bestellungen${q}`, d, t)).toBe(
                'reads a different table: `bestellungen`',
            );
        }
    });
});
