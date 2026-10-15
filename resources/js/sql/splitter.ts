import type { Dialect } from '@/types/schema';
import { tokenize } from './lexer';

export type SqlStatement = { sql: string; start: number; end: number };

export function splitStatements(sql: string, dialect: Dialect): SqlStatement[] {
    const out: SqlStatement[] = [];
    let start: number | null = null;
    let end = 0;
    let significant = false;
    const flush = () => {
        if (start !== null && significant)
            out.push({ sql: sql.slice(start, end), start, end });
        start = null;
        significant = false;
    };
    for (const t of tokenize(sql, dialect)) {
        if (t.type === 'semicolon') {
            flush();
            continue;
        }
        start ??= t.start;
        end = t.end;
        if (t.type !== 'comment') significant = true;
    }
    flush();
    return out;
}

export function statementAt(
    text: string,
    offset: number,
    dialect: Dialect,
): SqlStatement | null {
    const statements = splitStatements(text, dialect);
    if (statements.length === 0) return null;
    const inside = statements.find((s) => offset >= s.start && offset <= s.end);
    if (inside) return inside;
    const before = statements.filter((s) => s.end <= offset).at(-1);
    return before ?? statements[0];
}
