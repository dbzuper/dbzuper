import type { Dialect, RelationshipSchema, TableSchema } from '@/types/schema';

export function quoteIdent(name: string, dialect: Dialect): string {
    return dialect === 'mysql' || dialect === 'mariadb'
        ? '`' + name.replaceAll('`', '``') + '`'
        : '"' + name.replaceAll('"', '""') + '"';
}

export function generateDdl(
    table: TableSchema,
    relationships: RelationshipSchema[],
    dialect: Dialect,
): string {
    const q = (n: string) => quoteIdent(n, dialect);
    if (table.kind === 'view')
        return `-- ${table.name} is a view; its definition is not available for this engine.`;

    const lines = table.columns.map(
        (c) =>
            `  ${q(c.name)} ${c.type}${c.nullable ? '' : ' NOT NULL'}${c.default !== null ? ` DEFAULT ${c.default}` : ''}`,
    );
    if (table.primary_key.length > 0)
        lines.push(`  PRIMARY KEY (${table.primary_key.map(q).join(', ')})`);
    for (const r of relationships.filter(
        (r) => !r.inferred && r.from_table === table.name,
    )) {
        lines.push(
            `  ${r.name ? `CONSTRAINT ${q(r.name)} ` : ''}FOREIGN KEY (${r.from_columns.map(q).join(', ')}) REFERENCES ${q(r.to_table)} (${r.to_columns.map(q).join(', ')})`,
        );
    }

    const out = [`CREATE TABLE ${q(table.name)} (`, lines.join(',\n'), ');'];
    for (const i of table.indexes.filter((i) => !i.primary)) {
        out.push(
            `CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${q(i.name)} ON ${q(table.name)} (${i.columns.map(q).join(', ')});`,
        );
    }
    return out.join('\n');
}
