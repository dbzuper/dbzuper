import { memo } from 'react';
import { KeyRound, Link2 } from 'lucide-react';
import { formatRowCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TableSchema } from '@/types/schema';

export const CARD_COLUMNS = 10;

type Props = {
    table: TableSchema;
    fk: { declared: Set<string>; inferred: Set<string> };
    selected: boolean;
    onSelect: (table: string) => void;
    onFocus?: (table: string) => void;
};

export const TableCard = memo(function TableCard({
    table,
    fk,
    selected,
    onSelect,
    onFocus,
}: Props) {
    const shown = table.columns.slice(0, CARD_COLUMNS);
    const rest = table.columns.length - shown.length;
    const pk = new Set(table.primary_key);

    return (
        <div
            // Named by its visible text (table, rows, columns): WCAG 2.5.3 wants a label that
            // starts from what is on screen, which an aria-label like "Table orders" did not.
            role="button"
            tabIndex={0}
            onClick={() => onSelect(table.name)}
            onDoubleClick={() => onFocus?.(table.name)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(table.name);
                }
            }}
            className={cn(
                'pointer-events-auto w-56 rounded-lg border bg-card/95 text-left text-card-foreground shadow-sm backdrop-blur transition-colors select-none motion-reduce:transition-none',
                selected
                    ? 'border-[var(--universe-accent)]'
                    : 'hover:border-foreground/30',
            )}
        >
            <div className="flex items-center gap-2 border-b px-3 py-1.5">
                <span className="truncate font-mono text-xs font-semibold">
                    {table.name}
                </span>{' '}
                {table.kind === 'view' && (
                    <span className="rounded border border-dashed px-1 text-[10px] text-muted-foreground">
                        view
                    </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                    {formatRowCount(table.row_count)} rows
                </span>
            </div>
            <ul className="px-3 py-1.5">
                {shown.map((c) => (
                    <li
                        key={c.name}
                        className="flex items-center gap-1.5 py-0.5 font-mono text-[11px]"
                    >
                        <span className="flex w-3.5 shrink-0 justify-center">
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
                        </span>
                        <span className="truncate">{c.name}</span>
                        <span className="ml-auto truncate pl-2 text-muted-foreground">
                            {c.type}
                        </span>
                    </li>
                ))}
                {rest > 0 && (
                    <li className="py-0.5 text-[11px] text-muted-foreground">
                        +{rest} more
                    </li>
                )}
            </ul>
        </div>
    );
});
