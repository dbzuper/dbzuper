import type { SchemaSnapshot } from '@/types/schema';
import { makeSnapshot } from './snapshot';

/** Mirrors App\Support\Demo\SyntheticSchema's relationship structure. */
export function syntheticSnapshot(n: number): SchemaSnapshot {
    const name = (m: number, p: number) =>
        `m${String(m).padStart(3, '0')}_t${String(p).padStart(2, '0')}`;
    const tables = [];
    const rels = [];
    for (let i = 0; i < n; i++) {
        const m = Math.floor(i / 25);
        const p = i % 25;
        tables.push({
            name: name(m, p),
            row_count: { count: (i * 37) % 100000, kind: 'estimate' as const },
        });
        if (p > 0)
            rels.push({
                from_table: name(m, p),
                to_table: name(m, p - 1),
                from_columns: [`${name(m, p - 1)}_id`],
            });
        if (p > 1 && p % 2 === 0)
            rels.push({
                from_table: name(m, p),
                to_table: name(m, p - 2),
                from_columns: [`ref_${name(m, p - 2)}_id`],
            });
        if (p === 0 && m > 0)
            rels.push({
                from_table: name(m, p),
                to_table: name(m - 1, 0),
                from_columns: ['upstream_id'],
            });
    }
    return makeSnapshot(tables, rels);
}
