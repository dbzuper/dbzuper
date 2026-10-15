import type { Dialect, SchemaSnapshot, TableSchema } from '@/types/schema';
import { quoteIdent } from '@/universe/ddl';
import { KEYWORDS, RESERVED } from './keywords';
import { asciiUpper, identifierOf, tokenize } from './lexer';
import { statementAt } from './splitter';

export type Completion = {
    label: string;
    insertText: string;
    kind: 'table' | 'view' | 'column' | 'keyword' | 'join' | 'focused';
    detail?: string;
    sortText: string;
};

const TABLE_CONTEXT = new Set([
    'FROM',
    'JOIN',
    'UPDATE',
    'INTO',
    'TABLE',
    'DESCRIBE',
]);

export function identifierFor(name: string, dialect: Dialect): string {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
        !RESERVED.has(asciiUpper(name))
        ? name
        : quoteIdent(name, dialect);
}

type Scope = { table: TableSchema; alias: string | null }[];

function scopeOf(
    sql: string,
    dialect: Dialect,
    snapshot: SchemaSnapshot,
): Scope {
    const byName = new Map(
        snapshot.tables.map((t) => [t.name.toLowerCase(), t]),
    );
    const tokens = tokenize(sql, dialect).filter((t) => t.type !== 'comment');
    const scope: Scope = [];
    for (let i = 0; i < tokens.length; i++) {
        const kw = tokens[i].type === 'word' ? asciiUpper(tokens[i].value) : '';
        if (!TABLE_CONTEXT.has(kw)) continue;
        const name = tokens[i + 1];
        if (!name || (name.type !== 'word' && name.type !== 'quoted')) continue;
        const table = byName.get(identifierOf(name).toLowerCase());
        if (!table) continue;
        let k = i + 2;
        if (
            tokens[k]?.type === 'word' &&
            asciiUpper(tokens[k].value) === 'AS'
        ) {
            k++;
        }
        const aliasToken = tokens[k];
        const alias =
            aliasToken &&
            aliasToken.type === 'word' &&
            !RESERVED.has(asciiUpper(aliasToken.value))
                ? aliasToken.value
                : null;
        scope.push({ table, alias });
    }
    return scope;
}

function nextAlias(name: string, used: Set<string>): string {
    const base = name.replace(/[^A-Za-z]/g, '').toLowerCase() || 't';
    for (let n = 1; n <= base.length; n++) {
        const candidate = base.slice(0, n);
        if (!used.has(candidate)) return candidate;
    }
    let i = 2;
    while (used.has(`${base[0]}${i}`)) i++;
    return `${base[0]}${i}`;
}

export function completeSql(input: {
    text: string;
    offset: number;
    snapshot: SchemaSnapshot;
    dialect: Dialect;
    focusedTable: string | null;
}): { items: Completion[]; replaceFrom: number } {
    const { text, offset, snapshot, dialect, focusedTable } = input;
    let wordStart = offset;
    while (wordStart > 0 && /[A-Za-z0-9_$\u0080-￿]/.test(text[wordStart - 1])) {
        wordStart--;
    }
    const prefix = text.slice(wordStart, offset);
    const matches = (s: string) =>
        s.toLowerCase().startsWith(prefix.toLowerCase());

    if (text[wordStart - 1] === '@') {
        return {
            replaceFrom: wordStart - 1,
            items: focusedTable
                ? [
                      {
                          label: focusedTable,
                          insertText: identifierFor(focusedTable, dialect),
                          kind: 'focused',
                          detail: 'focused table',
                          sortText: '0',
                      },
                  ]
                : [],
        };
    }

    const statement = statementAt(text, offset, dialect);
    const sql = statement?.sql ?? '';
    const scope = scopeOf(sql, dialect, snapshot);

    if (text[wordStart - 1] === '.') {
        let q = wordStart - 1;
        while (q > 0 && /[A-Za-z0-9_$\u0080-￿"`\]]/.test(text[q - 1])) {
            q--;
        }
        const qualifier = text
            .slice(q, wordStart - 1)
            .replace(/^["`[]|["`\]]$/g, '')
            .toLowerCase();
        const entry = scope.find(
            (s) =>
                s.alias?.toLowerCase() === qualifier ||
                s.table.name.toLowerCase() === qualifier,
        ) ?? {
            table: snapshot.tables.find(
                (t) => t.name.toLowerCase() === qualifier,
            ),
            alias: null,
        };
        const columns = entry?.table?.columns ?? [];
        return {
            replaceFrom: wordStart,
            items: columns
                .filter((c) => matches(c.name))
                .map((c) => ({
                    label: c.name,
                    insertText: identifierFor(c.name, dialect),
                    kind: 'column' as const,
                    detail: c.type,
                    sortText: `1${c.name}`,
                }))
                .sort((a, b) => (a.label < b.label ? -1 : 1)),
        };
    }

    const before = tokenize(text.slice(0, wordStart), dialect).filter(
        (t) => t.type !== 'comment',
    );
    const previous = before.at(-1);
    const prevKw = previous?.type === 'word' ? asciiUpper(previous.value) : '';
    const tables = snapshot.tables
        .filter((t) => matches(t.name))
        .sort((a, b) => (a.name < b.name ? -1 : 1));
    const tableItems = tables.map((t) => ({
        label: t.name,
        insertText: identifierFor(t.name, dialect),
        kind: t.kind === 'view' ? ('view' as const) : ('table' as const),
        detail: t.kind,
        sortText: `2${t.name}`,
    }));

    if (TABLE_CONTEXT.has(prevKw)) {
        const items: Completion[] = [...tableItems];
        if (prevKw === 'JOIN' && scope.length > 0) {
            const used = new Set(
                scope.map((s) => (s.alias ?? s.table.name).toLowerCase()),
            );
            for (const rel of snapshot.relationships) {
                for (const left of scope) {
                    const leftRef =
                        left.alias ?? identifierFor(left.table.name, dialect);
                    const other =
                        rel.from_table === left.table.name
                            ? rel.to_table
                            : rel.to_table === left.table.name
                              ? rel.from_table
                              : null;
                    if (!other || !matches(other)) continue;
                    const alias = nextAlias(other, used);
                    const otherIsFrom = rel.from_table === other;
                    const otherCols = otherIsFrom
                        ? rel.from_columns
                        : rel.to_columns;
                    const leftCols = otherIsFrom
                        ? rel.to_columns
                        : rel.from_columns;
                    const on = otherCols
                        .map(
                            (c, k) =>
                                `${alias}.${identifierFor(c, dialect)} = ${leftRef}.${identifierFor(leftCols[k], dialect)}`,
                        )
                        .join(' AND ');
                    items.unshift({
                        label: `${other} ON ${on}`,
                        insertText: `${identifierFor(other, dialect)} ${alias} ON ${on}`,
                        kind: 'join',
                        detail: rel.inferred
                            ? 'inferred relationship'
                            : 'foreign key',
                        sortText: `0${other}`,
                    });
                }
            }
        }
        return { replaceFrom: wordStart, items };
    }

    const multi = scope.length > 1;
    const columnItems = scope.flatMap((s) =>
        s.table.columns
            .filter((c) => matches(c.name))
            .map((c) => ({
                label: multi ? `${s.alias ?? s.table.name}.${c.name}` : c.name,
                insertText: multi
                    ? `${s.alias ?? identifierFor(s.table.name, dialect)}.${identifierFor(c.name, dialect)}`
                    : identifierFor(c.name, dialect),
                kind: 'column' as const,
                detail: `${s.table.name} · ${c.type}`,
                sortText: `1${c.name}`,
            })),
    );
    const keywordItems = (
        prefix ? KEYWORDS[dialect].filter((k) => matches(k)) : []
    ).map((k) => ({
        label: k,
        insertText: k,
        kind: 'keyword' as const,
        sortText: `3${k}`,
    }));
    return {
        replaceFrom: wordStart,
        items: [...columnItems, ...tableItems, ...keywordItems],
    };
}
