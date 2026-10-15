import type { TableSchema } from '@/types/schema';

export function IndexesTab({ table }: { table: TableSchema }) {
    if (table.indexes.length === 0)
        return (
            <p className="px-4 py-3 text-xs text-muted-foreground">
                No indexes.
            </p>
        );
    return (
        <ul className="divide-y divide-border">
            {table.indexes.map((i) => (
                <li
                    key={i.name}
                    className="flex items-center gap-2 px-4 py-2 text-xs"
                >
                    <span className="font-mono">{i.name}</span>
                    <span className="font-mono text-muted-foreground">
                        ({i.columns.join(', ')})
                    </span>
                    <span className="ml-auto flex gap-1">
                        {i.primary && (
                            <span className="rounded border px-1.5 py-0.5 text-[10px]">
                                primary
                            </span>
                        )}
                        {i.unique && !i.primary && (
                            <span className="rounded border px-1.5 py-0.5 text-[10px]">
                                unique
                            </span>
                        )}
                    </span>
                </li>
            ))}
        </ul>
    );
}
