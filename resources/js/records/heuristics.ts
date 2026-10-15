import type { QueryCell } from '@/types/schema';

type Col = { name: string; type: string };
const TITLE_PRIORITY = ['name', 'title', 'email', 'slug', 'label'];
const SKIP_TYPE = /binary|blob|bytea|json/i;

export function titleColumn(columns: Col[]): string | null {
    for (const wanted of TITLE_PRIORITY) {
        const hit = columns.find((c) => c.name.toLowerCase() === wanted);
        if (hit) return hit.name;
    }
    return null;
}

export function recordTitle(
    columns: Col[],
    values: QueryCell[],
    primaryKey: string[],
): string {
    const t = titleColumn(columns);
    if (t !== null) {
        const v = values[columns.findIndex((c) => c.name === t)];
        if (v !== null && v !== undefined && String(v) !== '') return String(v);
    }
    return primaryKey
        .map((k) => {
            const v = values[columns.findIndex((c) => c.name === k)];
            return v === null || v === undefined ? '—' : String(v);
        })
        .join(' · ');
}

export function recordFields(
    columns: Col[],
    values: QueryCell[],
    primaryKey: string[],
    title: string | null,
    max = 5,
): { name: string; value: QueryCell }[] {
    const order = [
        ...primaryKey,
        ...columns.map((c) => c.name).filter((n) => !primaryKey.includes(n)),
    ];
    const out: { name: string; value: QueryCell }[] = [];
    for (const name of order) {
        if (out.length >= max) break;
        if (name === title) continue;
        const i = columns.findIndex((c) => c.name === name);
        if (i < 0) continue;
        const value = values[i];
        if (SKIP_TYPE.test(columns[i].type)) continue;
        if (
            typeof value === 'string' &&
            (/^\[binary \d+ bytes\]$/.test(value) ||
                Array.from(value).length > 80)
        )
            continue;
        out.push({ name, value });
    }
    return out;
}
