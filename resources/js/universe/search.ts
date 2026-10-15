import type { SchemaSnapshot } from '@/types/schema';

export type SearchHit =
    | {
          kind: 'table';
          table: string;
          tableKind: 'table' | 'view';
          score: number;
      }
    | {
          kind: 'column';
          table: string;
          column: string;
          type: string;
          score: number;
      };

export function scoreName(name: string, query: string): number {
    const n = name.toLowerCase();
    const q = query.toLowerCase();
    if (n === q) return 3;
    if (n.startsWith(q)) return 2;
    return n.includes(q) ? 1 : 0;
}

const byScoreThenName = (
    a: { score: number; key: string },
    b: { score: number; key: string },
) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function searchSchema(
    snapshot: SchemaSnapshot,
    query: string,
    limit = 20,
): { tables: SearchHit[]; columns: SearchHit[] } {
    const q = query.trim();
    const tables = snapshot.tables
        .map((t) => ({
            hit: {
                kind: 'table' as const,
                table: t.name,
                tableKind: t.kind,
                score: q ? scoreName(t.name, q) : 1,
            },
            key: t.name,
        }))
        .filter((x) => x.hit.score > 0)
        .sort((a, b) =>
            byScoreThenName(
                { score: a.hit.score, key: a.key },
                { score: b.hit.score, key: b.key },
            ),
        )
        .slice(0, limit)
        .map((x) => x.hit);

    if (q.length < 2) return { tables, columns: [] };

    const columns: { hit: SearchHit; key: string }[] = [];
    for (const t of snapshot.tables) {
        for (const c of t.columns) {
            const score = scoreName(c.name, q);
            if (score > 0)
                columns.push({
                    hit: {
                        kind: 'column',
                        table: t.name,
                        column: c.name,
                        type: c.type,
                        score,
                    },
                    key: `${t.name}.${c.name}`,
                });
        }
    }
    columns.sort((a, b) =>
        byScoreThenName(
            { score: a.hit.score, key: a.key },
            { score: b.hit.score, key: b.key },
        ),
    );

    return { tables, columns: columns.slice(0, limit).map((x) => x.hit) };
}
