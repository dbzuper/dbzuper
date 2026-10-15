import type { Dialect } from '@/types/schema';

export type SqlToken = {
    type:
        | 'word'
        | 'quoted'
        | 'string'
        | 'number'
        | 'punct'
        | 'semicolon'
        | 'comment';
    value: string;
    start: number;
    end: number;
};

const isSpace = (c: string) =>
    c === ' ' ||
    c === '\t' ||
    c === '\n' ||
    c === '\r' ||
    c === '\f' ||
    c === '\v';
const WORD_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;
const WORD = /[A-Za-z_\u0080-\uffff][A-Za-z0-9_$\u0080-\uffff]*/y;
const NUMBER = /[0-9]+(\.[0-9]+)?/y;
const DOLLAR_TAG = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;

/** ASCII-only case folding, matching PHP's strtoupper/strtolower. */
export const asciiUpper = (s: string) =>
    s.replace(/[a-z]+/g, (m) => m.toUpperCase());
export const asciiLower = (s: string) =>
    s.replace(/[A-Z]+/g, (m) => m.toLowerCase());

export function tokenize(sql: string, dialect: Dialect): SqlToken[] {
    const mysql = dialect === 'mysql' || dialect === 'mariadb';
    const pg = dialect === 'pgsql';
    const len = sql.length;
    const tokens: SqlToken[] = [];
    let i = 0;

    const matchAt = (re: RegExp, at: number): RegExpExecArray | null => {
        re.lastIndex = at;
        return re.exec(sql);
    };

    while (i < len) {
        const c = sql[i];
        const n = sql[i + 1] ?? '';

        if (isSpace(c)) {
            i++;
            continue;
        }

        // Line comments. MySQL requires whitespace/control (or end) after "--".
        const dash =
            c === '-' &&
            n === '-' &&
            (!mysql || i + 2 >= len || sql.charCodeAt(i + 2) <= 32);
        if (dash || (mysql && c === '#')) {
            let end = i;
            // PostgreSQL line comments also end at a bare carriage return.
            while (end < len && sql[end] !== '\n' && !(pg && sql[end] === '\r'))
                end++;
            tokens.push({
                type: 'comment',
                value: sql.slice(i, end),
                start: i,
                end,
            });
            i = end;
            continue;
        }

        if (c === '/' && n === '*') {
            let depth = 1;
            let j = i + 2;
            while (j < len && depth > 0) {
                if (pg && sql[j] === '/' && sql[j + 1] === '*') {
                    depth++;
                    j += 2;
                } else if (sql[j] === '*' && sql[j + 1] === '/') {
                    depth--;
                    j += 2;
                } else j++;
            }
            j = Math.min(j, len);
            tokens.push({
                type: 'comment',
                value: sql.slice(i, j),
                start: i,
                end: j,
            });
            i = j;
            continue;
        }

        if (pg && c === '$') {
            const m = matchAt(DOLLAR_TAG, i);
            if (m) {
                const tag = m[0];
                const close = sql.indexOf(tag, i + tag.length);
                const end = close === -1 ? len : close + tag.length;
                tokens.push({
                    type: 'string',
                    value: sql.slice(i, end),
                    start: i,
                    end,
                });
                i = end;
                continue;
            }
        }

        if (
            c === "'" ||
            c === '"' ||
            c === '`' ||
            (dialect === 'sqlite' && c === '[')
        ) {
            const close = c === '[' ? ']' : c;
            const ePrefix =
                pg &&
                c === "'" &&
                i > 0 &&
                (sql[i - 1] === 'E' || sql[i - 1] === 'e') &&
                (i < 2 || !WORD_CHAR.test(sql[i - 2]));
            const backslash = (mysql && (c === "'" || c === '"')) || ePrefix;
            let j = i + 1;
            while (j < len) {
                if (backslash && sql[j] === '\\') {
                    j += 2;
                    continue;
                }
                if (sql[j] === close) {
                    if (close !== ']' && sql[j + 1] === close) {
                        j += 2;
                        continue;
                    }
                    j++;
                    break;
                }
                j++;
            }
            j = Math.min(j, len);
            tokens.push({
                type: c === "'" || (mysql && c === '"') ? 'string' : 'quoted',
                value: sql.slice(i, j),
                start: i,
                end: j,
            });
            i = j;
            continue;
        }

        if (c === ';') {
            tokens.push({
                type: 'semicolon',
                value: ';',
                start: i,
                end: i + 1,
            });
            i++;
            continue;
        }

        const num = matchAt(NUMBER, i);
        if (num) {
            tokens.push({
                type: 'number',
                value: num[0],
                start: i,
                end: i + num[0].length,
            });
            i += num[0].length;
            continue;
        }

        const word = matchAt(WORD, i);
        if (word) {
            tokens.push({
                type: 'word',
                value: word[0],
                start: i,
                end: i + word[0].length,
            });
            i += word[0].length;
            continue;
        }

        tokens.push({ type: 'punct', value: c, start: i, end: i + 1 });
        i++;
    }

    return tokens;
}

/** Identifier text without quoting (for quoted and word tokens). */
export function identifierOf(token: SqlToken): string {
    if (token.type !== 'quoted') return token.value;
    const open = token.value[0];
    const inner = token.value.slice(1, -1);
    return open === '[' ? inner : inner.split(open + open).join(open);
}
