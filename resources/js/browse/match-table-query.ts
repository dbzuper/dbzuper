/**
 * Strict matcher from a hand-edited SELECT back to a table tab's filters, sort and page (spec §5).
 *
 * A false "fits" silently shows the user different rows than the SQL they typed, so this
 * fails closed: anything outside the small grammar below is "doesn't fit", with a reason.
 *
 *   SELECT ( * | col [, col …] ) FROM table
 *   [ WHERE cond ( AND cond )* ]  [ ORDER BY col [ASC|DESC] [, …] ]
 *   [ LIMIT n [ OFFSET m ] | LIMIT m, n ]
 */
import type {
    FilterOp,
    PerPage,
    RowFilter,
    SortKey,
} from '@/lib/workspace-api';
import { PER_PAGE_OPTIONS } from '@/lib/workspace-api';
import { asciiLower, asciiUpper, tokenize } from '@/sql/lexer';
import type { SqlToken } from '@/sql/lexer';
import type { ColumnSchema, Dialect, TableSchema } from '@/types/schema';

/** perPage null = the statement has no LIMIT (keep the tab's page size). */
export type MatchedState = {
    filters: RowFilter[];
    sort: SortKey[];
    page: number;
    perPage: PerPage | null;
};
export type MatchResult =
    | { ok: true; state: MatchedState }
    | { ok: false; reason: string };

// The server's TableRowsRequest limits.
const MAX_FILTERS = 20;
const MAX_SORT = 3;
const MAX_VALUE_CHARS = 1000;
const MAX_PAGE = 100000;
/** MySQL/MariaDB compare a number with the server's quoted value as a double. */
const MYSQL_MAX_DIGITS = 15;

const pageSizes = (() => {
    const all = PER_PAGE_OPTIONS.map(String);
    return `${all.slice(0, -1).join(', ')} or ${all[all.length - 1]}`;
})();

/** Every reason the matcher gives, in one place so the SQL dock can reuse the wording. */
export const MATCH_REASONS = {
    or: "`OR` can't be expressed as table filters",
    not: "`NOT` can't be expressed as table filters",
    join: 'joins another table',
    groupBy: '`GROUP BY`',
    distinct: '`DISTINCT`',
    subquery: 'a subquery',
    someColumns: 'selects only some columns',
    multipleStatements: 'more than one statement',
    notSelect: 'not a SELECT',
    midWildcard: 'wildcards in the middle of a pattern',
    pgLike: 'LIKE is case-sensitive on PostgreSQL; use ILIKE',
    ilikeNotPg: 'ILIKE is PostgreSQL only',
    tooManySorts: `more than ${MAX_SORT} sort columns`,
    tooManyConditions: `more than ${MAX_FILTERS} conditions`,
    nullComparison: 'compares with `NULL`; use `IS NULL`',
    likeNoWildcard: 'a LIKE pattern without `%` at the start or end',
    likeEscape: 'an unsupported `ESCAPE` in a pattern',
    executableComment: 'a MySQL `/*! … */` comment',
    unterminated: 'an unterminated string, identifier or comment',
    endsEarly: 'the statement ends early',
    emptyValue: 'compares with an empty string',
    longValue: `a value longer than ${MAX_VALUE_CHARS} characters`,
    nulValue: 'a value with a NUL character',
    keyword: (keyword: string) => `\`${keyword}\``,
    fn: (name: string) => `uses a function: \`${name}(…)\``,
    differentTable: (name: string) => `reads a different table: \`${name}\``,
    unknownColumn: (name: string) => `unknown column \`${name}\``,
    // Used by the SQL dock when the linked table tab's table is gone (spec §6).
    missingTable: (name: string) => `\`${name}\` no longer exists`,
    reservedWord: (word: string) => `\`${word}\` is a reserved word; quote it`,
    numberVsColumn: (column: string, type: string) =>
        `compares column \`${column}\` (${type}) with a number`,
    booleanVsColumn: (column: string, type: string) =>
        `compares column \`${column}\` (${type}) with \`TRUE\`/\`FALSE\``,
    tooPrecise: (num: string) =>
        `the number ${num} has more than ${MYSQL_MAX_DIGITS} significant digits`,
    ilikeNeedsCast: (column: string, type: string) =>
        `ILIKE on column \`${column}\` (${type}) needs \`CAST(… AS TEXT)\``,
    pageSize: (limit: string) =>
        `LIMIT ${limit} isn't a page size: ${pageSizes}`,
    offset: (offset: string, perPage: number) =>
        `OFFSET ${offset} isn't a multiple of the page size ${perPage}`,
    pastLastPage: (page: number) =>
        `page ${page} is past the last page a table can show (${MAX_PAGE})`,
    repeatedColumn: (name: string) => `selects \`${name}\` more than once`,
    repeatedSort: (name: string) => `sorts by \`${name}\` more than once`,
    unsupported: (text: string) =>
        `unsupported syntax near \`${text.length > 40 ? `${text.slice(0, 40)}…` : text}\``,
} as const;

function words(list: string): Set<string> {
    return new Set(list.trim().split(/\s+/));
}

class NoFit {
    constructor(readonly reason: string) {}
}

const JOIN_WORDS = new Set([
    'JOIN',
    'INNER',
    'LEFT',
    'RIGHT',
    'FULL',
    'OUTER',
    'CROSS',
    'NATURAL',
    'STRAIGHT_JOIN',
    'LATERAL',
]);
/** Words explain() names with their own reason when they stand where a name should. */
const EXPLAINED = new Set([
    ...JOIN_WORDS,
    'OR',
    'XOR',
    'NOT',
    'GROUP',
    'DISTINCT',
    'HAVING',
    'UNION',
    'INTERSECT',
    'EXCEPT',
    'MINUS',
    'WINDOW',
    'IN',
    'BETWEEN',
    'EXISTS',
    'CASE',
]);
/**
 * Words each engine reserves: bare, they are a syntax error or a built-in value
 * (`current_user`, `CURRENT_DATE`, …), never a column. Over-inclusion only means "quote it".
 */
const ENGINE_RESERVED: Record<'mysql' | 'pgsql' | 'sqlite', Set<string>> = {
    mysql: words(`
        ACCESSIBLE ADD ALL ALTER ANALYZE AND AS ASC ASENSITIVE BEFORE BETWEEN BIGINT BINARY BLOB
        BOTH BY CALL CASCADE CASE CHANGE CHAR CHARACTER CHECK COLLATE COLUMN CONDITION CONSTRAINT
        CONTINUE CONVERT CREATE CROSS CUBE CUME_DIST CURRENT_DATE CURRENT_ROLE CURRENT_TIME
        CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DATABASES DAY_HOUR DAY_MICROSECOND
        DAY_MINUTE DAY_SECOND DEC DECIMAL DECLARE DEFAULT DELAYED DELETE DENSE_RANK DESC DESCRIBE
        DETERMINISTIC DISTINCT DISTINCTROW DIV DO_DOMAIN_IDS DOUBLE DROP DUAL EACH ELSE ELSEIF
        EMPTY ENCLOSED ESCAPED EXCEPT EXISTS EXIT EXPLAIN FALSE FETCH FIRST_VALUE FLOAT FLOAT4
        FLOAT8 FOR FORCE FOREIGN FROM FULLTEXT FUNCTION GENERAL GENERATED GET GRANT GROUP GROUPING
        GROUPS HAVING HIGH_PRIORITY HOUR_MICROSECOND HOUR_MINUTE HOUR_SECOND IF IGNORE
        IGNORE_DOMAIN_IDS IGNORE_SERVER_IDS IN INDEX INFILE INNER INOUT INSENSITIVE INSERT INT INT1
        INT2 INT3 INT4 INT8 INTEGER INTERSECT INTERVAL INTO IO_AFTER_GTIDS IO_BEFORE_GTIDS IS
        ITERATE JOIN JSON_TABLE KEY KEYS KILL LAG LAST_VALUE LATERAL LEAD LEADING LEAVE LEFT LIKE
        LIMIT LINEAR LINES LOAD LOCALTIME LOCALTIMESTAMP LOCK LONG LONGBLOB LONGTEXT LOOP
        LOW_PRIORITY MASTER_BIND MASTER_HEARTBEAT_PERIOD MASTER_SSL_VERIFY_SERVER_CERT MATCH
        MAXVALUE MEDIUMBLOB MEDIUMINT MEDIUMTEXT MIDDLEINT MINUTE_MICROSECOND MINUTE_SECOND MOD
        MODIFIES NATURAL NOT NO_WRITE_TO_BINLOG NTH_VALUE NTILE NULL NUMERIC OF OFFSET ON OPTIMIZE
        OPTIMIZER_COSTS OPTION OPTIONALLY OR ORDER OUT OUTER OUTFILE OVER PAGE_CHECKSUM
        PARSE_VCOL_EXPR PARTITION PERCENT_RANK POSITION PRECISION PRIMARY PROCEDURE PURGE RANGE
        RANK READ READS READ_WRITE REAL RECURSIVE REF_SYSTEM_ID REFERENCES REGEXP RELEASE RENAME
        REPEAT REPLACE REQUIRE RESIGNAL RESTRICT RETURN RETURNING REVOKE RIGHT RLIKE ROW ROWS
        ROW_NUMBER SCHEMA SCHEMAS SECOND_MICROSECOND SELECT SENSITIVE SEPARATOR SET SHOW SIGNAL
        SLOW SMALLINT SPATIAL SPECIFIC SQL SQLEXCEPTION SQLSTATE SQLWARNING SQL_BIG_RESULT
        SQL_CALC_FOUND_ROWS SQL_SMALL_RESULT SSL STARTING STATS_AUTO_RECALC STATS_PERSISTENT
        STATS_SAMPLE_PAGES STORED STRAIGHT_JOIN SYSTEM TABLE TERMINATED THEN TINYBLOB TINYINT
        TINYTEXT TO TRAILING TRIGGER TRUE UNDO UNION UNIQUE UNLOCK UNSIGNED UPDATE USAGE USE USING
        UTC_DATE UTC_TIME UTC_TIMESTAMP VALUES VARBINARY VARCHAR VARCHARACTER VARYING VIRTUAL WHEN
        WHERE WHILE WINDOW WITH WRITE XOR YEAR_MONTH ZEROFILL
    `),
    pgsql: words(`
        ALL ANALYSE ANALYZE AND ANY ARRAY AS ASC ASYMMETRIC AUTHORIZATION BINARY BOTH CASE CAST
        CHECK COLLATE COLLATION COLUMN CONCURRENTLY CONSTRAINT CREATE CROSS CURRENT_CATALOG
        CURRENT_DATE CURRENT_ROLE CURRENT_SCHEMA CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER
        DEFAULT DEFERRABLE DESC DISTINCT DO ELSE END EXCEPT FALSE FETCH FOR FOREIGN FREEZE FROM
        FULL GRANT GROUP HAVING ILIKE IN INITIALLY INNER INTERSECT INTO IS ISNULL JOIN LATERAL
        LEADING LEFT LIKE LIMIT LOCALTIME LOCALTIMESTAMP NATURAL NOT NOTNULL NULL OFFSET ON ONLY
        OR ORDER OUTER OVERLAPS PLACING PRIMARY REFERENCES RETURNING RIGHT SELECT SESSION_USER
        SIMILAR SOME SYMMETRIC SYSTEM_USER TABLE TABLESAMPLE THEN TO TRAILING TRUE UNION UNIQUE
        USER USING VARIADIC VERBOSE WHEN WHERE WINDOW WITH
    `),
    sqlite: words(`
        ADD ALL ALTER AND AS AUTOINCREMENT BETWEEN CASE CHECK COLLATE COMMIT CONSTRAINT CREATE
        CROSS CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP DEFAULT DEFERRABLE DELETE DISTINCT DROP
        ELSE ESCAPE EXCEPT EXISTS FOREIGN FROM FULL GLOB GROUP HAVING IN INDEX INNER INSERT
        INTERSECT INTO IS ISNULL JOIN LEFT LIKE LIMIT MATCH NATURAL NOT NOTHING NOTNULL NULL ON OR
        ORDER OUTER PRIMARY REFERENCES REGEXP RETURNING RIGHT SELECT SET TABLE THEN TO TRANSACTION
        UNION UNIQUE UPDATE USING VALUES WHEN WHERE WINDOW
    `),
};
/** Words that are never a bare column or table name in this grammar. */
const RESERVED = new Set([
    ...JOIN_WORDS,
    'SELECT',
    'FROM',
    'WHERE',
    'AND',
    'OR',
    'XOR',
    'NOT',
    'NULL',
    'TRUE',
    'FALSE',
    'ORDER',
    'BY',
    'GROUP',
    'HAVING',
    'LIMIT',
    'OFFSET',
    'ON',
    'USING',
    'AS',
    'DISTINCT',
    'ALL',
    'UNION',
    'INTERSECT',
    'EXCEPT',
    'MINUS',
    'IS',
    'IN',
    'LIKE',
    'ILIKE',
    'BETWEEN',
    'EXISTS',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
    'ESCAPE',
    'ASC',
    'DESC',
    'FOR',
    'WITH',
    'INTO',
    'VALUES',
    'CAST',
    'COLLATE',
    'BINARY',
    'INTERVAL',
    'ANY',
    'SOME',
    'WINDOW',
    'FETCH',
]);
const COMPARE: Record<string, FilterOp> = {
    '=': 'eq',
    '<>': 'neq',
    '!=': 'neq',
    '<': 'lt',
    '<=': 'lte',
    '>': 'gt',
    '>=': 'gte',
};
/** Characters PostgreSQL glues into one operator token (so `!=-5` is not `!=` then `-5`). */
const PG_OPERATOR_CHARS = '+-*/<>=~!@#%^&|`?';
const MYSQL_ESCAPES: Record<string, string> = {
    '0': '\0',
    b: '\b',
    n: '\n',
    r: '\r',
    t: '\t',
    Z: '\x1a',
    '%': '\\%',
    _: '\\_',
};

type Ident = { name: string; bare: boolean; token: SqlToken };
type Literal = { kind: 'string' | 'number' | 'boolean'; text: string };

const typeLabel = (c: ColumnSchema) => c.type || c.type_name || 'untyped';
const lowerTrim = (s: string | null | undefined) => asciiLower(s ?? '').trim();
/** The type name without size or modifiers, lower case: `type_name`, else `type`. */
const baseType = (c: ColumnSchema) =>
    lowerTrim(c.type_name || c.type)
        .split('(')[0]
        .trim();

const MYSQL_NUMERIC = words(
    'tinyint smallint mediumint int integer bigint decimal numeric dec fixed float double real',
);
const PG_NUMERIC = new Set([
    'int2',
    'int4',
    'int8',
    'smallint',
    'integer',
    'bigint',
    'numeric',
    'decimal',
    'float4',
    'float8',
    'real',
    'double precision',
]);

/** SQLite's declared-type affinity (INTEGER, REAL or NUMERIC), limited to clearly numeric names. */
function sqliteNumeric(c: ColumnSchema): boolean {
    const decl = asciiUpper(c.type || c.type_name || '');
    if (decl.includes('INT')) return true;
    if (decl.trim() === '' || /CHAR|CLOB|TEXT|BLOB/.test(decl)) return false;
    return /REAL|FLOA|DOUB|NUMERIC|DECIMAL|BOOL/.test(decl);
}

function isNumericColumn(c: ColumnSchema, dialect: Dialect): boolean {
    if (dialect === 'sqlite') return sqliteNumeric(c);
    if (dialect === 'pgsql')
        return (
            PG_NUMERIC.has(baseType(c)) ||
            PG_NUMERIC.has(lowerTrim(c.type).split('(')[0].trim())
        );
    return MYSQL_NUMERIC.has(baseType(c));
}

function isBooleanColumn(c: ColumnSchema, dialect: Dialect): boolean {
    const base = baseType(c);
    if (dialect === 'pgsql')
        return (
            base === 'bool' ||
            base === 'boolean' ||
            lowerTrim(c.type) === 'boolean'
        );
    if (dialect === 'sqlite')
        return (
            asciiUpper(c.type || c.type_name || '').includes('BOOL') ||
            lowerTrim(c.type).startsWith('tinyint(1)')
        );
    return (
        base === 'bool' ||
        base === 'boolean' ||
        lowerTrim(c.type).startsWith('tinyint(1)')
    );
}

/** PostgreSQL types where a bare `col ILIKE` reads the same as `CAST(col AS TEXT) ILIKE`. */
function isPgTextColumn(c: ColumnSchema): boolean {
    const type = lowerTrim(c.type);
    return (
        ['text', 'varchar', 'citext', 'character varying'].includes(
            baseType(c),
        ) &&
        (type === '' ||
            type === 'text' ||
            type === 'citext' ||
            type.startsWith('character varying') ||
            type.startsWith('varchar'))
    );
}

class Matcher {
    private i = 0;
    private readonly mysql: boolean;
    private readonly pg: boolean;
    private readonly reserved: Set<string>;

    constructor(
        private readonly t: SqlToken[],
        private readonly dialect: Dialect,
        private readonly table: TableSchema,
        private readonly schema: string | null,
    ) {
        this.mysql = dialect === 'mysql' || dialect === 'mariadb';
        this.pg = dialect === 'pgsql';
        this.reserved =
            ENGINE_RESERVED[
                this.mysql ? 'mysql' : this.pg ? 'pgsql' : 'sqlite'
            ];
    }

    run(): MatchedState {
        if (!this.isWord(this.peek(), 'SELECT'))
            throw new NoFit(MATCH_REASONS.notSelect);
        this.i++;
        this.selectList();
        this.expectWord('FROM');
        this.fromTable();

        const filters: RowFilter[] = [];
        if (this.isWord(this.peek(), 'WHERE')) {
            this.i++;
            this.conjunction(filters);
            if (filters.length > MAX_FILTERS)
                throw new NoFit(MATCH_REASONS.tooManyConditions);
        }

        let sort: SortKey[] = [];
        if (this.isWord(this.peek(), 'ORDER')) {
            this.i++;
            this.expectWord('BY');
            sort = this.orderBy();
        }

        let page = 1;
        let perPage: PerPage | null = null;
        if (this.isWord(this.peek(), 'LIMIT')) {
            this.i++;
            [page, perPage] = this.limit();
        }

        if (this.i < this.t.length) this.fail();

        return { filters, sort, page, perPage };
    }

    // ---- clauses ----

    private selectList(): void {
        if (this.isPunct(this.peek(), '*')) {
            this.i++;
            return;
        }
        const seen = new Set<string>();
        for (;;) {
            const name = this.columnRef();
            if (seen.has(name))
                throw new NoFit(MATCH_REASONS.repeatedColumn(name));
            seen.add(name);
            if (!this.isPunct(this.peek(), ',')) break;
            this.i++;
        }
        if (!this.isWord(this.peek(), 'FROM')) this.fail();
        if (seen.size !== this.table.columns.length)
            throw new NoFit(MATCH_REASONS.someColumns);
    }

    private fromTable(): void {
        if (this.isPunct(this.peek(), '(')) this.fail();
        const first = this.identifier();
        let qualifier: Ident | null = null;
        let name = first;
        if (this.isPunct(this.peek(), '.')) {
            this.i++;
            qualifier = first;
            name = this.identifier();
            if (this.isPunct(this.peek(), '.')) this.fail();
        }
        const typed = qualifier ? `${qualifier.name}.${name.name}` : name.name;
        if (
            qualifier &&
            (this.schema === null || !this.resolveTable(qualifier, this.schema))
        )
            throw new NoFit(MATCH_REASONS.differentTable(typed));
        if (!this.resolveTable(name, this.table.name))
            throw new NoFit(MATCH_REASONS.differentTable(typed));
        if (this.isPunct(this.peek(), ',')) throw new NoFit(MATCH_REASONS.join);
    }

    /** cond ( AND cond )*, where a cond may be wrapped in parentheses holding only ANDs. */
    private conjunction(filters: RowFilter[]): void {
        for (;;) {
            if (this.isPunct(this.peek(), '(')) {
                if (this.startsSubquery(this.i)) this.fail();
                this.i++;
                this.conjunction(filters);
                if (!this.isPunct(this.peek(), ')')) this.fail();
                this.i++;
            } else {
                filters.push(this.condition());
            }
            if (!this.isWord(this.peek(), 'AND')) return;
            this.i++;
        }
    }

    private condition(): RowFilter {
        let column: string;
        let castAt: number | null = null;
        const cast = this.peek();
        if (
            this.pg &&
            this.isWord(cast, 'CAST') &&
            this.isPunct(this.peek(1), '(')
        ) {
            const shaped =
                (this.peek(2)?.type === 'word' ||
                    this.peek(2)?.type === 'quoted') &&
                this.isWord(this.peek(3), 'AS') &&
                this.isWord(this.peek(4), 'TEXT') &&
                this.isPunct(this.peek(5), ')');
            if (!shaped) this.fail();
            castAt = this.i;
            this.i += 2;
            column = this.columnRef();
            this.i += 3;
        } else {
            column = this.columnRef();
            const c1 = this.peek();
            const c2 = this.peek(1);
            if (
                this.pg &&
                c1 !== undefined &&
                c2 !== undefined &&
                this.isPunct(c1, ':') &&
                this.isPunct(c2, ':') &&
                c1.end === c2.start
            ) {
                castAt = this.i;
                this.i += 2;
                const type = this.peek();
                if (
                    !this.isWord(type, 'TEXT') ||
                    this.isPunct(this.peek(1), '(')
                )
                    throw new NoFit(MATCH_REASONS.unsupported('::'));
                this.i++;
            }
        }

        const op = this.peek();
        if (this.isWord(op, 'LIKE') || this.isWord(op, 'ILIKE')) {
            const ilike = this.isWord(op, 'ILIKE');
            if (this.pg && !ilike) throw new NoFit(MATCH_REASONS.pgLike);
            if (!this.pg && ilike) throw new NoFit(MATCH_REASONS.ilikeNotPg);
            // The server writes CAST(col AS TEXT) ILIKE; a bare column only reads the same when
            // it is already unpadded text (char(n) pads, other types don't ILIKE at all).
            const schema = this.columnSchema(column);
            if (this.pg && castAt === null && !isPgTextColumn(schema))
                throw new NoFit(
                    MATCH_REASONS.ilikeNeedsCast(column, typeLabel(schema)),
                );
            this.i++;
            const pattern = this.stringLiteral();
            let escape: string | null = this.dialect === 'sqlite' ? null : '\\';
            if (this.isWord(this.peek(), 'ESCAPE')) {
                this.i++;
                escape = this.stringLiteral();
            }
            const filter = likeFilter(column, pattern, escape);
            checkValue(filter.value ?? '');
            return filter;
        }

        // Cast forms only stand in front of LIKE / ILIKE.
        if (castAt !== null) this.fail(castAt);

        if (this.isWord(op, 'IS')) {
            this.i++;
            let not = false;
            if (this.isWord(this.peek(), 'NOT')) {
                this.i++;
                not = true;
            }
            if (!this.isWord(this.peek(), 'NULL')) this.fail();
            this.i++;
            return { column, op: not ? 'is_not_null' : 'is_null' };
        }

        const filterOp = this.comparison();
        const value = this.typedValue(
            this.columnSchema(column),
            this.literal(),
        );
        // The server requires a value for comparisons.
        if (value === '') throw new NoFit(MATCH_REASONS.emptyValue);
        checkValue(value);
        return { column, op: filterOp, value };
    }

    private comparison(): FilterOp {
        const start = this.i;
        let text = '';
        let prev: SqlToken | null = null;
        for (;;) {
            const tok = this.peek();
            if (
                tok?.type !== 'punct' ||
                !'<>=!'.includes(tok.value) ||
                (prev && prev.end !== tok.start)
            )
                break;
            text += tok.value;
            prev = tok;
            this.i++;
        }
        const op = COMPARE[text];
        if (op === undefined) this.fail(start);
        const next = this.peek();
        if (
            this.pg &&
            prev &&
            next?.type === 'punct' &&
            next.start === prev.end &&
            PG_OPERATOR_CHARS.includes(next.value)
        )
            this.fail(start);
        return op;
    }

    private literal(): Literal {
        const tok = this.peek();
        if (this.isWord(tok, 'NULL'))
            throw new NoFit(MATCH_REASONS.nullComparison);
        if (
            (this.isWord(tok, 'TRUE') || this.isWord(tok, 'FALSE')) &&
            !this.isPunct(this.peek(1), '(')
        ) {
            this.i++;
            return { kind: 'boolean', text: asciiUpper(tok?.value ?? '') };
        }
        if (tok?.type === 'string')
            return { kind: 'string', text: this.stringLiteral() };
        let sign = '';
        if (this.isPunct(tok, '-') && this.peek(1)?.type === 'number') {
            sign = '-';
            this.i++;
        }
        const num = this.peek();
        if (num?.type === 'number') {
            this.i++;
            return { kind: 'number', text: sign + num.value };
        }
        return this.fail();
    }

    /**
     * The server always binds the value as a string (`col op '…'`). A string literal is exactly
     * that; a number or TRUE/FALSE only reads the same against a column of the matching type.
     */
    private typedValue(column: ColumnSchema, literal: Literal): string {
        if (literal.kind === 'string') return literal.text;
        if (literal.kind === 'number') {
            if (!isNumericColumn(column, this.dialect))
                throw new NoFit(
                    MATCH_REASONS.numberVsColumn(
                        column.name,
                        typeLabel(column),
                    ),
                );
            // MySQL compares a number with a quoted value as doubles: exact up to 15 digits.
            const digits = literal.text.replace(/[-.]/g, '').replace(/^0+/, '');
            if (this.mysql && digits.length > MYSQL_MAX_DIGITS)
                throw new NoFit(MATCH_REASONS.tooPrecise(literal.text));
            return literal.text;
        }
        if (!isBooleanColumn(column, this.dialect))
            throw new NoFit(
                MATCH_REASONS.booleanVsColumn(column.name, typeLabel(column)),
            );
        const truthy = literal.text === 'TRUE';
        // PostgreSQL reads 'true'/'false' for booleans; MySQL, MariaDB and SQLite define TRUE as 1.
        if (this.pg) return truthy ? 'true' : 'false';
        return truthy ? '1' : '0';
    }

    private orderBy(): SortKey[] {
        const keys: SortKey[] = [];
        for (;;) {
            const column = this.columnRef();
            if (keys.some((k) => k.column === column))
                throw new NoFit(MATCH_REASONS.repeatedSort(column));
            let direction: SortKey['direction'] = 'asc';
            if (this.isWord(this.peek(), 'ASC')) this.i++;
            else if (this.isWord(this.peek(), 'DESC')) {
                this.i++;
                direction = 'desc';
            }
            keys.push({ column, direction });
            if (!this.isPunct(this.peek(), ',')) break;
            this.i++;
        }
        const sort = dropTieBreakers(keys, this.table.primary_key);
        if (sort.length > MAX_SORT) throw new NoFit(MATCH_REASONS.tooManySorts);
        return sort;
    }

    private limit(): [number, PerPage] {
        const a = this.integer();
        let count = a;
        let offset = { text: '0', value: 0 };
        if (this.mysql && this.isPunct(this.peek(), ',')) {
            this.i++;
            offset = a;
            count = this.integer();
        } else if (this.isWord(this.peek(), 'OFFSET')) {
            this.i++;
            offset = this.integer();
        }
        const perPage = PER_PAGE_OPTIONS.find((n) => n === count.value);
        if (perPage === undefined)
            throw new NoFit(MATCH_REASONS.pageSize(count.text));
        if (offset.value % perPage !== 0)
            throw new NoFit(MATCH_REASONS.offset(offset.text, perPage));
        const page = offset.value / perPage + 1;
        if (page > MAX_PAGE) throw new NoFit(MATCH_REASONS.pastLastPage(page));
        return [page, perPage];
    }

    // ---- terminals ----

    private integer(): { text: string; value: number } {
        const tok = this.peek();
        if (tok?.type !== 'number' || !/^[0-9]+$/.test(tok.value)) this.fail();
        const value = Number(tok.value);
        if (!Number.isSafeInteger(value)) this.fail();
        this.i++;
        return { text: tok.value, value };
    }

    /** A single-quoted string, decoded with the engine's escapes. */
    private stringLiteral(): string {
        const tok = this.peek();
        if (tok?.type !== 'string' || tok.value[0] !== "'") this.fail();
        const v = tok.value;
        let out = '';
        let closed = false;
        let i = 1;
        while (i < v.length) {
            const c = v[i];
            if (this.mysql && c === '\\') {
                const n = v[i + 1];
                if (n === undefined) break;
                out += MYSQL_ESCAPES[n] ?? n;
                i += 2;
                continue;
            }
            if (c === "'") {
                if (v[i + 1] === "'") {
                    out += "'";
                    i += 2;
                    continue;
                }
                closed = i === v.length - 1;
                break;
            }
            out += c;
            i++;
        }
        if (!closed) throw new NoFit(MATCH_REASONS.unterminated);
        this.i++;
        return out;
    }

    /** A bare or engine-quoted identifier (not a keyword, not a call, not qualified). */
    private identifier(): Ident {
        const tok = this.peek();
        if (tok?.type === 'word') {
            const upper = asciiUpper(tok.value);
            if (EXPLAINED.has(upper) || this.isPunct(this.peek(1), '('))
                this.fail();
            if (RESERVED.has(upper) || this.reserved.has(upper))
                throw new NoFit(MATCH_REASONS.reservedWord(tok.value));
            this.i++;
            return { name: tok.value, bare: true, token: tok };
        }
        if (tok?.type === 'quoted') {
            const quote = this.mysql ? '`' : '"';
            if (tok.value[0] !== quote) this.fail();
            const v = tok.value;
            const inner = v.slice(1, -1);
            if (
                v.length < 3 ||
                v[v.length - 1] !== quote ||
                inner
                    .split(quote + quote)
                    .join('')
                    .includes(quote)
            )
                throw new NoFit(MATCH_REASONS.unterminated);
            this.i++;
            return {
                name: inner.split(quote + quote).join(quote),
                bare: false,
                token: tok,
            };
        }
        return this.fail();
    }

    private columnRef(): string {
        const id = this.identifier();
        if (this.isPunct(this.peek(), '.')) this.fail();
        const name = this.resolve(
            id,
            this.table.columns.map((c) => c.name),
        );
        if (name === null)
            throw new NoFit(MATCH_REASONS.unknownColumn(id.name));
        return name;
    }

    private columnSchema(name: string): ColumnSchema {
        const column = this.table.columns.find((c) => c.name === name);
        if (!column) throw new NoFit(MATCH_REASONS.unknownColumn(name));
        return column;
    }

    /** MySQL/MariaDB table and schema names are case-sensitive on Linux: match them exactly. */
    private resolveTable(id: Ident, name: string): boolean {
        if (this.mysql) return id.name === name;
        return this.resolve(id, [name]) !== null;
    }

    /**
     * Quoted names match exactly. PostgreSQL folds bare names to lower case, then matches
     * exactly; elsewhere a bare name falls back to a case-insensitive match when unambiguous.
     */
    private resolve(id: Ident, names: string[]): string | null {
        if (!id.bare) return names.includes(id.name) ? id.name : null;
        if (this.pg) {
            const folded = asciiLower(id.name);
            return names.includes(folded) ? folded : null;
        }
        if (names.includes(id.name)) return id.name;
        const lower = asciiLower(id.name);
        const hits = names.filter((n) => asciiLower(n) === lower);
        return hits.length === 1 ? hits[0] : null;
    }

    // ---- helpers ----

    private peek(k = 0): SqlToken | undefined {
        return this.t[this.i + k];
    }

    private isWord(tok: SqlToken | undefined, keyword: string): boolean {
        return tok?.type === 'word' && asciiUpper(tok.value) === keyword;
    }

    private isPunct(tok: SqlToken | undefined, c: string): boolean {
        return tok?.type === 'punct' && tok.value === c;
    }

    private expectWord(keyword: string): void {
        if (!this.isWord(this.peek(), keyword)) this.fail();
        this.i++;
    }

    private startsSubquery(at: number): boolean {
        const next = this.t[at + 1];
        return (
            this.isPunct(this.t[at], '(') &&
            (this.isWord(next, 'SELECT') || this.isWord(next, 'WITH'))
        );
    }

    /** Stops at the token that doesn't fit, naming it as plainly as possible. */
    private fail(at = this.i): never {
        throw new NoFit(this.explain(at));
    }

    private explain(at: number): string {
        const tok = this.t[at];
        const next = this.t[at + 1];
        if (!tok) return MATCH_REASONS.endsEarly;
        if (tok.type === 'word') {
            const word = asciiUpper(tok.value);
            if (word === 'OR' || word === 'XOR') return MATCH_REASONS.or;
            if (word === 'NOT') return MATCH_REASONS.not;
            if (JOIN_WORDS.has(word)) return MATCH_REASONS.join;
            if (word === 'GROUP') return MATCH_REASONS.groupBy;
            if (word === 'DISTINCT') return MATCH_REASONS.distinct;
            if (this.startsSubquery(at + 1)) return MATCH_REASONS.subquery;
            if (
                [
                    'HAVING',
                    'UNION',
                    'INTERSECT',
                    'EXCEPT',
                    'MINUS',
                    'WINDOW',
                    'IN',
                    'BETWEEN',
                    'EXISTS',
                    'CASE',
                ].includes(word)
            )
                return MATCH_REASONS.keyword(word);
            if (this.isPunct(next, '(')) return MATCH_REASONS.fn(tok.value);
        }
        if (this.startsSubquery(at)) return MATCH_REASONS.subquery;
        if (
            this.mysql &&
            this.isPunct(tok, '|') &&
            this.isPunct(next, '|') &&
            tok.end === next.start
        )
            return MATCH_REASONS.or;
        if (
            tok.type === 'string' &&
            tok.value[0] === "'" &&
            !this.stringClosed(tok)
        )
            return MATCH_REASONS.unterminated;
        return MATCH_REASONS.unsupported(tok.value);
    }

    private stringClosed(tok: SqlToken): boolean {
        const inner = tok.value.slice(1, -1);
        return (
            tok.value.length >= 2 &&
            tok.value.endsWith("'") &&
            (this.mysql || !inner.split("''").join('').includes("'"))
        );
    }
}

/** Values the server's request validation would refuse don't fit. */
function checkValue(value: string): void {
    if (value.includes('\0')) throw new NoFit(MATCH_REASONS.nulValue);
    if (Array.from(value).length > MAX_VALUE_CHARS)
        throw new NoFit(MATCH_REASONS.longValue);
}

/** Maps a LIKE pattern to contains / starts_with / ends_with, or doesn't fit. */
function likeFilter(
    column: string,
    pattern: string,
    escape: string | null,
): RowFilter {
    if (
        escape !== null &&
        (Array.from(escape).length !== 1 || escape === '%' || escape === '_')
    )
        throw new NoFit(MATCH_REASONS.likeEscape);
    const chars = Array.from(pattern);
    const units: { ch: string; wild: boolean }[] = [];
    for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (escape !== null && c === escape) {
            const n = chars[i + 1];
            if (n !== '%' && n !== '_' && n !== escape)
                throw new NoFit(MATCH_REASONS.likeEscape);
            units.push({ ch: n, wild: false });
            i++;
        } else units.push({ ch: c, wild: c === '%' || c === '_' });
    }
    const isPercent = (u: { ch: string; wild: boolean } | undefined) =>
        u !== undefined && u.wild && u.ch === '%';
    const lead = isPercent(units[0]);
    const trail = units.length > 1 && isPercent(units[units.length - 1]);
    const middle = units.slice(lead ? 1 : 0, trail ? -1 : undefined);
    if (middle.some((u) => u.wild)) throw new NoFit(MATCH_REASONS.midWildcard);
    if (!lead && !trail) throw new NoFit(MATCH_REASONS.likeNoWildcard);
    const value = middle.map((u) => u.ch).join('');
    const op: FilterOp =
        lead && trail ? 'contains' : lead ? 'ends_with' : 'starts_with';
    return { column, op, value };
}

/**
 * The server appends the primary-key columns that aren't sort keys, ascending, as tie-breakers.
 * A trailing run that is exactly a prefix of what it would append is dropped.
 */
function dropTieBreakers(keys: SortKey[], primaryKey: string[]): SortKey[] {
    for (let k = keys.length; k > 0; k--) {
        const kept = keys.slice(0, keys.length - k);
        const dropped = keys.slice(keys.length - k);
        const appended = primaryKey.filter(
            (c) => !kept.some((s) => s.column === c),
        );
        if (
            dropped.length <= appended.length &&
            dropped.every(
                (s, j) => s.direction === 'asc' && s.column === appended[j],
            )
        )
            return kept;
    }
    return keys;
}

function checkComments(tokens: SqlToken[], dialect: Dialect): void {
    const mysql = dialect === 'mysql' || dialect === 'mariadb';
    for (const tok of tokens) {
        if (tok.type !== 'comment' || !tok.value.startsWith('/*')) continue;
        if (mysql && /^\/\*(!|M!)/i.test(tok.value))
            throw new NoFit(MATCH_REASONS.executableComment);
        if (tok.value.length < 4 || !tok.value.endsWith('*/'))
            throw new NoFit(MATCH_REASONS.unterminated);
        if (dialect === 'pgsql') {
            // PostgreSQL nests block comments: the lexer stops at the last */ even when unbalanced.
            let depth = 0;
            for (let i = 0; i < tok.value.length; i++) {
                const pair = tok.value.slice(i, i + 2);
                if (pair === '/*') {
                    depth++;
                    i++;
                } else if (pair === '*/') {
                    depth--;
                    i++;
                }
            }
            if (depth !== 0) throw new NoFit(MATCH_REASONS.unterminated);
        }
    }
}

export function matchTableQuery(
    sql: string,
    dialect: Dialect,
    table: TableSchema,
    schema: string | null = null,
): MatchResult {
    try {
        const all = tokenize(sql, dialect);
        checkComments(all, dialect);
        const tokens = all.filter((t) => t.type !== 'comment');
        const semi = tokens.findIndex((t) => t.type === 'semicolon');
        if (semi !== -1 && semi !== tokens.length - 1)
            throw new NoFit(MATCH_REASONS.multipleStatements);
        if (semi !== -1) tokens.pop();
        const state = new Matcher(tokens, dialect, table, schema).run();
        return { ok: true, state };
    } catch (e) {
        if (e instanceof NoFit) return { ok: false, reason: e.reason };
        throw e;
    }
}
