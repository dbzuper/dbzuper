import type {
    Dialect,
    RelationshipSchema,
    SchemaSnapshot,
} from '@/types/schema';
import { quoteIdent } from './ddl';

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function adjacency(
    snapshot: SchemaSnapshot,
    includeInferred: boolean,
): Map<string, string[]> {
    const adj = new Map<string, Set<string>>();
    const add = (a: string, b: string) =>
        adj.set(a, (adj.get(a) ?? new Set()).add(b));
    for (const r of snapshot.relationships) {
        if (r.from_table === r.to_table || (!includeInferred && r.inferred))
            continue;
        add(r.from_table, r.to_table);
        add(r.to_table, r.from_table);
    }
    return new Map(
        [...adj.entries()].map(([k, v]) => [k, [...v].sort(byName)]),
    );
}

export function findPath(
    snapshot: SchemaSnapshot,
    from: string,
    to: string,
    includeInferred: boolean,
): string[] | null {
    if (from === to) return [from];
    const adj = adjacency(snapshot, includeInferred);
    const prev = new Map<string, string>([[from, from]]);
    let frontier = [from];
    while (frontier.length > 0) {
        const next: string[] = [];
        for (const node of frontier) {
            for (const n of adj.get(node) ?? []) {
                if (prev.has(n)) continue;
                prev.set(n, node);
                if (n === to) {
                    const path = [to];
                    let cur = to;
                    while (cur !== from) {
                        cur = prev.get(cur)!;
                        path.unshift(cur);
                    }
                    return path;
                }
                next.push(n);
            }
        }
        frontier = next;
    }
    return null;
}

function relationshipBetween(
    snapshot: SchemaSnapshot,
    a: string,
    b: string,
    includeInferred: boolean,
): RelationshipSchema | null {
    const candidates = snapshot.relationships.filter(
        (r) =>
            ((r.from_table === a && r.to_table === b) ||
                (r.from_table === b && r.to_table === a)) &&
            (includeInferred || !r.inferred),
    );
    candidates.sort(
        (x, y) =>
            Number(x.inferred) - Number(y.inferred) ||
            y.confidence - x.confidence ||
            byName(x.id, y.id),
    );
    return candidates[0] ?? null;
}

export function buildJoinSql(
    snapshot: SchemaSnapshot,
    path: string[],
    dialect: Dialect,
    includeInferred: boolean,
): string | null {
    const q = (n: string) => quoteIdent(n, dialect);
    const lines = ['SELECT *', `FROM ${q(path[0])} AS t0`];
    for (let i = 1; i < path.length; i++) {
        const rel = relationshipBetween(
            snapshot,
            path[i - 1],
            path[i],
            includeInferred,
        );
        if (!rel) return null;
        const curIsFrom = rel.from_table === path[i];
        const curCols = curIsFrom ? rel.from_columns : rel.to_columns;
        const prevCols = curIsFrom ? rel.to_columns : rel.from_columns;
        const on = curCols
            .map((c, k) => `t${i}.${q(c)} = t${i - 1}.${q(prevCols[k])}`)
            .join(' AND ');
        lines.push(`JOIN ${q(path[i])} AS t${i} ON ${on}`);
    }
    lines.push('LIMIT 100;');
    return lines.join('\n');
}
