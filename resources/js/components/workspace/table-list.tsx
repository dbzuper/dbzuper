import { formatRowCount } from '@/lib/format';
import type { SchemaSnapshot } from '@/types/schema';

export function TableList({ snapshot, filter }: { snapshot: SchemaSnapshot; filter: string }) {
    const degree = new Map<string, number>();
    for (const r of snapshot.relationships) {
        degree.set(r.from_table, (degree.get(r.from_table) ?? 0) + 1);
        if (r.to_table !== r.from_table) degree.set(r.to_table, (degree.get(r.to_table) ?? 0) + 1);
    }

    const needle = filter.trim().toLowerCase();
    const tables = snapshot.tables.filter((t) => t.name.toLowerCase().includes(needle));

    return (
        <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 text-right font-medium">Rows</th>
                    <th className="px-3 py-2 text-right font-medium">Columns</th>
                    <th className="px-3 py-2 text-right font-medium">Relations</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-border">
                {tables.map((t) => (
                    <tr key={t.name}>
                        <td className="px-3 py-2 font-mono">
                            {t.name}
                            {t.kind === 'view' && <span className="ml-2 rounded border border-dashed px-1 text-xs text-muted-foreground">view</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatRowCount(t.row_count)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{t.columns.length}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums" aria-label={`${t.name} relationships`}>{degree.get(t.name) ?? 0}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
