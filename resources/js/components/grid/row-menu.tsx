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
    /** Editing actions for the clicked cell and rows (Set NULL, Revert change, Delete row…), shown first. */
    editItems?: { label: string; onSelect: () => void }[];
};

const plural = (n: number) => `${n} row${n === 1 ? '' : 's'}`;

/** What rows can be copied as; the row menu and the selection bar offer the same formats. */
export const COPY_FORMATS = ['JSON', 'INSERT', 'CSV'] as const;
export type CopyFormat = (typeof COPY_FORMATS)[number];

/** Copies `rows` in `format` to the clipboard and says how it went in a toast. */
export async function copyRows(
    format: CopyFormat,
    {
        dialect,
        table,
        columns,
        rows,
    }: {
        dialect: Dialect;
        table: string;
        columns: QueryColumn[];
        rows: QueryCell[][];
    },
) {
    const text =
        format === 'JSON'
            ? toJSON(columns, rows)
            : format === 'INSERT'
              ? toInsert(dialect, table, columns, rows)
              : toCSV(columns, rows);
    if (await writeClipboard(text))
        toast.success(`Copied ${plural(rows.length)}`);
    else toast.error('Could not copy');
}

export function RowMenu({
    dialect,
    table,
    columns,
    rows,
    onOpenRow,
    editItems = [],
}: Props) {
    return (
        <ContextMenuContent>
            {editItems.length > 0 && (
                <>
                    {editItems.map((item) => (
                        <ContextMenuItem
                            key={item.label}
                            onSelect={item.onSelect}
                        >
                            {item.label}
                        </ContextMenuItem>
                    ))}
                    {(onOpenRow || rows.length > 0) && <ContextMenuSeparator />}
                </>
            )}
            {onOpenRow && (
                <>
                    <ContextMenuItem onSelect={onOpenRow}>
                        Open row
                    </ContextMenuItem>
                    {rows.length > 0 && <ContextMenuSeparator />}
                </>
            )}
            {rows.length > 0 &&
                COPY_FORMATS.map((format) => (
                    <ContextMenuItem
                        key={format}
                        onSelect={() =>
                            void copyRows(format, {
                                dialect,
                                table,
                                columns,
                                rows,
                            })
                        }
                    >
                        {`Copy as ${format}`}
                    </ContextMenuItem>
                ))}
        </ContextMenuContent>
    );
}
