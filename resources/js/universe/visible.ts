import type { SchemaSnapshot } from '@/types/schema';

export function pickCardNodes(
    points: { key: string; x: number; y: number }[],
    width: number,
    height: number,
    max: number,
    margin = 80,
): string[] {
    const cx = width / 2;
    const cy = height / 2;
    return points
        .filter(
            (p) =>
                p.x >= -margin &&
                p.x <= width + margin &&
                p.y >= -margin &&
                p.y <= height + margin,
        )
        .map((p) => ({ key: p.key, d: Math.hypot(p.x - cx, p.y - cy) }))
        .sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : 1))
        .slice(0, max)
        .map((p) => p.key);
}

export function fkColumnsByTable(
    snapshot: SchemaSnapshot,
): Map<string, { declared: Set<string>; inferred: Set<string> }> {
    const out = new Map<
        string,
        { declared: Set<string>; inferred: Set<string> }
    >();
    for (const r of snapshot.relationships) {
        const entry = out.get(r.from_table) ?? {
            declared: new Set<string>(),
            inferred: new Set<string>(),
        };
        for (const c of r.from_columns)
            (r.inferred ? entry.inferred : entry.declared).add(c);
        out.set(r.from_table, entry);
    }
    return out;
}
