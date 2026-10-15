import type { Dialect } from '@/types/schema';
import {
    asciiLower,
    asciiUpper,
    identifierOf,
    tokenize,
    type SqlToken,
} from './lexer';

export type StatementKind =
    | 'read'
    | 'write'
    | 'ddl'
    | 'destructive'
    | 'transaction'
    | 'session';
export type Classification = {
    kind: StatementKind;
    keyword: string;
    target: string | null;
};

const DDL = [
    'CREATE',
    'ALTER',
    'COMMENT',
    'GRANT',
    'REVOKE',
    'RENAME',
    'REINDEX',
    'CLUSTER',
    'VACUUM',
    'ANALYZE',
    'OPTIMIZE',
    'REPAIR',
    'ATTACH',
    'DETACH',
    'SECURITY',
];
const WRITE = [
    'INSERT',
    'REPLACE',
    'MERGE',
    'UPSERT',
    'CALL',
    'DO',
    'COPY',
    'LOAD',
    'HANDLER',
    'LOCK',
    'UNLOCK',
    'IMPORT',
    'EXECUTE',
    'PREPARE',
    'DEALLOCATE',
];
const TRANSACTION = [
    'BEGIN',
    'START',
    'COMMIT',
    'ROLLBACK',
    'SAVEPOINT',
    'RELEASE',
    'END',
    'ABORT',
    'XA',
];
const SESSION = [
    'SET',
    'USE',
    'RESET',
    'DISCARD',
    'LISTEN',
    'NOTIFY',
    'UNLISTEN',
];
/** EXPLAIN (...) options and values that cannot execute the statement; anything else counts as ANALYZE. */
const EXPLAIN_HARMLESS = [
    'VERBOSE',
    'COSTS',
    'SETTINGS',
    'BUFFERS',
    'WAL',
    'TIMING',
    'SUMMARY',
    'MEMORY',
    'SERIALIZE',
    'GENERIC_PLAN',
    'FORMAT',
    'TEXT',
    'XML',
    'JSON',
    'YAML',
    'TRUE',
    'FALSE',
    'ON',
    'OFF',
    'NONE',
    'BINARY',
];
/** SQLite introspection pragmas that are read-only with or without an argument. */
const PRAGMA_WITH_ARG = [
    'TABLE_INFO',
    'TABLE_XINFO',
    'TABLE_LIST',
    'INDEX_LIST',
    'INDEX_INFO',
    'INDEX_XINFO',
    'FOREIGN_KEY_LIST',
    'FOREIGN_KEY_CHECK',
    'DATABASE_LIST',
    'COLLATION_LIST',
    'FUNCTION_LIST',
    'MODULE_LIST',
    'PRAGMA_LIST',
    'COMPILE_OPTIONS',
    'INTEGRITY_CHECK',
    'QUICK_CHECK',
    'PAGE_COUNT',
    'FREELIST_COUNT',
];
/** SQLite setting pragmas that only read when given no argument. */
const PRAGMA_NO_ARG = [
    'SCHEMA_VERSION',
    'USER_VERSION',
    'APPLICATION_ID',
    'PAGE_SIZE',
    'ENCODING',
    'JOURNAL_MODE',
    'FOREIGN_KEYS',
];

const upper = (t: SqlToken) => asciiUpper(t.value);
const isPunct = (t: SqlToken | undefined, v: string): boolean =>
    t !== undefined && t.type === 'punct' && t.value === v;
const isWord = (t: SqlToken | undefined, w?: string): boolean =>
    t !== undefined && t.type === 'word' && (w === undefined || upper(t) === w);
const result = (
    kind: StatementKind,
    keyword: string,
    target: string | null = null,
): Classification => ({ kind, keyword, target });

export function classify(sql: string, dialect: Dialect): Classification {
    const all = tokenize(sql, dialect);
    const tokens = all.filter(
        (t) => t.type !== 'comment' && t.type !== 'semicolon',
    );
    const leading = tokens[0]?.type === 'word' ? upper(tokens[0]) : '';

    // MySQL/MariaDB executable comments (/*! */, /*M! */) may run their contents: fail closed.
    if (dialect === 'mysql' || dialect === 'mariadb') {
        for (const t of all) {
            if (t.type === 'comment' && /^\/\*M?!/.test(t.value))
                return result('write', leading);
        }
    }

    // PostgreSQL U&'...' / U&"..." can spell any identifier or string via escapes: fail closed.
    if (dialect === 'pgsql') {
        for (let k = 0; k < tokens.length; k++) {
            const t = tokens[k];
            const amp = tokens[k + 1];
            const lit = tokens[k + 2];
            if (
                t.type === 'word' &&
                upper(t) === 'U' &&
                amp &&
                lit &&
                isPunct(amp, '&') &&
                amp.start === t.end &&
                (lit.type === 'string' || lit.type === 'quoted') &&
                lit.start === amp.end
            ) {
                return result('write', leading);
            }
        }
    }

    // Anything significant after a semicolon means multi-statement input: never trust the first keyword.
    let seenSemicolon = false;
    for (const t of all) {
        if (t.type === 'semicolon') seenSemicolon = true;
        else if (seenSemicolon && t.type !== 'comment')
            return result('write', leading);
    }

    return classifyTokens(tokens);
}

function classifyTokens(t: SqlToken[]): Classification {
    const first = t[0]?.type === 'word' ? upper(t[0]) : '';
    if (first === '') return result('write', '');

    if (['EXPLAIN', 'DESCRIBE', 'DESC'].includes(first))
        return explain(t, first);
    if (first === 'SELECT') return select(t);
    if (first === 'WITH') return withStatement(t);
    if (first === 'SHOW') return result('read', first);
    if (first === 'VALUES' || first === 'TABLE') return select(t, first);
    if (first === 'PRAGMA') return pragma(t);
    if (first === 'UPDATE' || first === 'DELETE')
        return updateOrDelete(t, first);
    if (first === 'DROP') {
        return result(
            'destructive',
            'DROP',
            nameAfter(t, 1, [
                'TABLE',
                'VIEW',
                'INDEX',
                'DATABASE',
                'SCHEMA',
                'SEQUENCE',
                'FUNCTION',
                'PROCEDURE',
                'TRIGGER',
                'TYPE',
                'MATERIALIZED',
                'TEMPORARY',
                'TEMP',
                'IF',
                'EXISTS',
                'CONCURRENTLY',
                'EXTENSION',
                'ROLE',
                'USER',
            ]),
        );
    }
    if (first === 'TRUNCATE')
        return result(
            'destructive',
            'TRUNCATE',
            nameAfter(t, 1, ['TABLE', 'ONLY']),
        );
    if (TRANSACTION.includes(first)) return transaction(t, first);
    if (SESSION.includes(first)) return result('session', first);
    if (DDL.includes(first)) return result('ddl', first);
    if (WRITE.includes(first)) return result('write', first);
    return result('write', first);
}

function explain(t: SqlToken[], first: string): Classification {
    let i = 1;
    let analyze = false;
    // Skip option words and a parenthesised option list.
    while (i < t.length) {
        const w = t[i].type === 'word' ? upper(t[i]) : null;
        if (isPunct(t[i], '(')) {
            let depth = 0;
            for (; i < t.length; i++) {
                const tok = t[i];
                if (
                    tok.type === 'word' ||
                    tok.type === 'quoted' ||
                    tok.type === 'string'
                ) {
                    const name =
                        tok.type === 'word'
                            ? tok.value
                            : tok.type === 'string'
                              ? tok.value.replace(/^'+|'+$/g, '')
                              : identifierOf(tok);
                    if (!EXPLAIN_HARMLESS.includes(asciiUpper(name)))
                        analyze = true;
                }
                if (isPunct(tok, '(')) {
                    depth++;
                } else if (isPunct(tok, ')') && --depth === 0) {
                    i++;
                    break;
                }
            }
            continue;
        }
        if (w === 'ANALYZE' || w === 'ANALYSE') {
            analyze = true;
            i++;
            continue;
        }
        if (
            (w !== null &&
                [
                    'VERBOSE',
                    'EXTENDED',
                    'PARTITIONS',
                    'FORMAT',
                    'QUERY',
                    'PLAN',
                    'FOR',
                ].includes(w)) ||
            t[i].type === 'punct'
        ) {
            i++;
            continue;
        }
        break;
    }

    if (!analyze) return result('read', first);
    return classifyTokens(t.slice(i));
}

function select(t: SqlToken[], keyword = 'SELECT'): Classification {
    let depth = 0;
    let session = false;
    for (let k = 0; k < t.length; k++) {
        const token = t[k];
        // set_config() changes session settings (e.g. default_transaction_read_only).
        if (
            (token.type === 'word' || token.type === 'quoted') &&
            asciiLower(identifierOf(token)) === 'set_config'
        )
            session = true;
        if (isPunct(token, '(')) {
            depth++;
        } else if (isPunct(token, ')')) {
            depth = Math.max(0, depth - 1);
        } else if (depth === 0 && token.type === 'word') {
            const w = upper(token);
            const next = t[k + 1];
            if (w === 'INTO') return result('write', keyword);
            if (
                w === 'FOR' &&
                next &&
                ['UPDATE', 'SHARE', 'NO', 'KEY'].includes(upper(next))
            )
                return result('write', keyword);
            if (w === 'LOCK' && next && upper(next) === 'IN')
                return result('write', keyword);
        }
    }
    return result(session ? 'session' : 'read', keyword);
}

function withStatement(t: SqlToken[]): Classification {
    const main = mainStatementIndex(t);
    if (main !== null && ['UPDATE', 'DELETE'].includes(upper(t[main]))) {
        const c = updateOrDelete(t.slice(main), upper(t[main]));
        return result(c.kind, 'WITH', c.target);
    }
    if (hasWord(t, ['INSERT', 'UPDATE', 'DELETE', 'MERGE']))
        return result('write', 'WITH');
    return select(t, 'WITH');
}

/** Index of the statement keyword that follows the CTE list, or null when the list cannot be parsed. */
function mainStatementIndex(t: SqlToken[]): number | null {
    let i = 1;
    if (isWord(t[i], 'RECURSIVE')) i++;
    for (;;) {
        if (i >= t.length || (t[i].type !== 'word' && t[i].type !== 'quoted'))
            return null;
        i++;
        if (isPunct(t[i], '(')) i = skipGroup(t, i);
        if (!isWord(t[i], 'AS')) return null;
        i++;
        if (isWord(t[i], 'NOT')) i++;
        if (isWord(t[i], 'MATERIALIZED')) i++;
        if (!isPunct(t[i], '(')) return null;
        i = skipGroup(t, i);
        if (isPunct(t[i], ',')) {
            i++;
            continue;
        }
        return i < t.length && t[i].type === 'word' ? i : null;
    }
}

/** Index just past the balanced group opening at i. */
function skipGroup(t: SqlToken[], i: number): number {
    let depth = 0;
    for (; i < t.length; i++) {
        if (isPunct(t[i], '(')) depth++;
        else if (isPunct(t[i], ')') && --depth === 0) return i + 1;
    }
    return i;
}

function pragma(t: SqlToken[]): Classification {
    let i = 1;
    if (isPunct(t[i + 1], '.')) i += 2; // schema prefix
    const name =
        i < t.length && (t[i].type === 'word' || t[i].type === 'quoted')
            ? asciiUpper(identifierOf(t[i]))
            : '';
    const hasArg = isPunct(t[i + 1], '(');
    const readOnly =
        !t.some((x) => isPunct(x, '=')) &&
        (PRAGMA_WITH_ARG.includes(name) ||
            (PRAGMA_NO_ARG.includes(name) && !hasArg));
    return result(readOnly ? 'read' : 'session', 'PRAGMA');
}

function transaction(t: SqlToken[], first: string): Classification {
    const second = t[1]?.type === 'word' ? upper(t[1]) : '';
    if (first === 'START' && second !== 'TRANSACTION')
        return result('write', first);
    if (first === 'XA' && (second === 'COMMIT' || second === 'ROLLBACK'))
        return result('write', first);
    if ((first === 'COMMIT' || first === 'ROLLBACK') && second === 'PREPARED')
        return result('write', first);
    return readWritePair(t)
        ? result('session', first)
        : result('transaction', first);
}

function updateOrDelete(t: SqlToken[], first: string): Classification {
    let depth = 0;
    for (const token of t) {
        if (isPunct(token, '(')) depth++;
        else if (isPunct(token, ')')) depth = Math.max(0, depth - 1);
        else if (
            depth === 0 &&
            token.type === 'word' &&
            upper(token) === 'WHERE'
        )
            return result('write', first);
    }
    const skip =
        first === 'UPDATE'
            ? [
                  'LOW_PRIORITY',
                  'IGNORE',
                  'ONLY',
                  'OR',
                  'ROLLBACK',
                  'ABORT',
                  'REPLACE',
                  'FAIL',
              ]
            : ['LOW_PRIORITY', 'QUICK', 'IGNORE', 'FROM', 'ONLY'];
    return result('destructive', first, nameAfter(t, 1, skip));
}

/** The (possibly dotted) object name starting at i after skipping the given keywords. */
function nameAfter(t: SqlToken[], i: number, skip: string[]): string | null {
    while (i < t.length && t[i].type === 'word' && skip.includes(upper(t[i])))
        i++;
    const parts: string[] = [];
    while (i < t.length && (t[i].type === 'word' || t[i].type === 'quoted')) {
        parts.push(identifierOf(t[i]));
        if (t[i + 1]?.value === '.') {
            i += 2;
            continue;
        }
        break;
    }
    return parts.length === 0 ? null : parts.join('.');
}

function hasWord(t: SqlToken[], words: string[]): boolean {
    return t.some((x) => x.type === 'word' && words.includes(upper(x)));
}

/** "READ WRITE" anywhere relaxes a read-only session. */
function readWritePair(t: SqlToken[]): boolean {
    return t.some((x, k) => isWord(x, 'READ') && isWord(t[k + 1], 'WRITE'));
}
