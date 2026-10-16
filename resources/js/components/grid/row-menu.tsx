import { toast } from 'sonner';
import {
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { toCSV, toInsert, toJSON, writeClipboard } from '@/grid/copy';
import type { Dialect, QueryCell, QueryColumn } from '@/types/schema';

type Props = {
    dialect: Dialect;
    table: string;
    columns: QueryColumn[];
    /** The rows the menu acts on: the clicked row alone, or every selected row. */
    rows: QueryCell[][];
    onOpenRow?: () => void;
};

const plural = (n: number) => `${n} row${n === 1 ? '' : 's'}`;

export function RowMenu({ dialect, table, columns, rows, onOpenRow }: Props) {
    const copy = async (text: string) => {
        if (await writeClipboard(text))
            toast.success(`Copied ${plural(rows.length)}`);
        else toast.error('Could not copy');
    };
    return (
        <ContextMenuContent>
            {onOpenRow && (
                <>
                    <ContextMenuItem onSelect={onOpenRow}>
                        Open row
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                </>
            )}
            <ContextMenuItem onSelect={() => copy(toJSON(columns, rows))}>
                Copy as JSON
            </ContextMenuItem>
            <ContextMenuItem
                onSelect={() => copy(toInsert(dialect, table, columns, rows))}
            >
                Copy as INSERT
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => copy(toCSV(columns, rows))}>
                Copy as CSV
            </ContextMenuItem>
        </ContextMenuContent>
    );
}
