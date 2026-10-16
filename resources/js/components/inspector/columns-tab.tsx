import { KeyRound, Link2 } from 'lucide-react';
import type { TableSchema } from '@/types/schema';

export function ColumnsTab({
    table,
    fk,
}: {
    table: TableSchema;
    fk: { declared: Set<string>; inferred: Set<string> };
}) {
    const pk = new Set(table.primary_key);
    return (
        <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background text-left text-[10px] tracking-wide text-muted-foreground uppercase">
                <tr>
                    <th className="w-6 px-3 py-2" />
                    <th className="py-2 font-medium">Column</th>
                    <th className="py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Default</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-border">
                {table.columns.map((c) => (
                    <tr key={c.name}>
                        <td className="px-3 py-1.5">
                            {pk.has(c.name) ? (
                                <KeyRound
                                    aria-label="primary key"
                                    className="size-3 text-warning"
                                />
                            ) : fk.declared.has(c.name) ? (
                                <Link2
                                    aria-label="foreign key"
                                    className="size-3 text-[var(--universe-accent)]"
                                />
                            ) : fk.inferred.has(c.name) ? (
                                <Link2
                                    aria-label="inferred foreign key"
                                    className="size-3 text-muted-foreground"
                                />
                            ) : null}
                        </td>
                        <td className="py-1.5 font-mono">
                            <span>{c.name}</span>
                            {!c.nullable && (
                                <span className="ml-1 text-[10px] text-muted-foreground">
                                    NOT NULL
                                </span>
                            )}
                        </td>
                        <td className="py-1.5 font-mono text-muted-foreground">
                            {c.type}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground">
                            {c.auto_increment ? 'auto' : (c.default ?? '')}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
