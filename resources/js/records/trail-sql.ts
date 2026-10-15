import { quoteIdent } from '@/universe/ddl';
import type { Dialect, SchemaSnapshot } from '@/types/schema';
import { pathTo, type Trail } from './trail';

const NUMERIC = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const BOOLEAN_TYPE = /^(bool|boolean|tinyint\(1\))$/i;

function literal(
    value: string | number,
    dialect: Dialect,
    columnType: string | undefined,
): string {
    if (typeof value === 'number') return String(value);
    if (
        (value === 'true' || value === 'false') &&
        columnType !== undefined &&
        BOOLEAN_TYPE.test(columnType.trim())
    ) {
        if (dialect === 'pgsql') return value === 'true' ? 'TRUE' : 'FALSE';
        return value === 'true' ? '1' : '0';
    }
    if (NUMERIC.test(value)) return value;
    const escaped = value.replaceAll("'", "''");
    return `'${dialect === 'mysql' || dialect === 'mariadb' ? escaped.replaceAll('\\', '\\\\') : escaped}'`;
}

/** SELECT the target record by joining along the trail path from its root. Null when the path or a relationship is missing. */
export function buildTrailSql(
    trail: Trail,
    targetId: string,
    snapshot: SchemaSnapshot,
    dialect: Dialect,
): string | null {
    const path = pathTo(trail, targetId);
    if (!path) return null;
    const q = (n: string) => quoteIdent(n, dialect);
    const root = path.nodes[0];
    const rootTable = snapshot.tables.find((t) => t.name === root.table);
    if (
        !rootTable ||
        rootTable.primary_key.length === 0 ||
        rootTable.primary_key.some((k) => !(k in root.key))
    )
        return null;

    const joins: string[] = [];
    for (let i = 1; i < path.nodes.length; i++) {
        const edge = path.edges[i - 1];
        const rel = snapshot.relationships.find((r) => r.id === edge.rel);
        if (!rel) return null;
        const [mine, theirs] =
            edge.dir === 'out'
                ? [rel.to_columns, rel.from_columns]
                : [rel.from_columns, rel.to_columns];
        if (mine.length === 0 || mine.length !== theirs.length) return null;
        const on = mine
            .map((c, k) => `t${i}.${q(c)} = t${i - 1}.${q(theirs[k])}`)
            .join(' AND ');
        joins.push(`JOIN ${q(path.nodes[i].table)} AS t${i} ON ${on}`);
    }

    const where = rootTable.primary_key
        .map(
            (k) =>
                `t0.${q(k)} = ${literal(root.key[k], dialect, rootTable.columns.find((c) => c.name === k)?.type)}`,
        )
        .join(' AND ');
    return [
        `SELECT t${path.nodes.length - 1}.*`,
        `FROM ${q(root.table)} AS t0`,
        ...joins,
        `WHERE ${where}`,
        'LIMIT 100;',
    ].join('\n');
}
