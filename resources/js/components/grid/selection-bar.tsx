import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Dialect, QueryCell, QueryColumn } from '@/types/schema';
import { COPY_FORMATS, copyRows } from './row-menu';

const rowsLabel = (n: number) => `${n} row${n === 1 ? '' : 's'}`;

/**
 * Above the grid while rows are selected: the count, Copy as (the row menu's formats), Delete or Restore (where the
 * row menu offers it) and Clear.
 */
export function SelectionBar({
    count,
    copy,
    remove,
    onClear,
}: {
    /** How many rows are selected (the grid announces it in its own live region). */
    count: number;
    /** What Copy as copies (new rows aren't in the table yet, so they are left out); none hides it. */
    copy: {
        dialect: Dialect;
        table: string;
        columns: QueryColumn[];
        rows: QueryCell[][];
    } | null;
    /** Stages the selected rows' deletion, or restores rows already marked; none hides it. */
    remove: { restore: boolean; count: number; onSelect: () => void } | null;
    onClear: () => void;
}) {
    const button = 'h-6 px-2 text-xs';
    return (
        <div
            role="toolbar"
            aria-label="Selected rows"
            className="flex h-8 shrink-0 items-center gap-1 border-b bg-muted px-3 text-xs"
        >
            <span className="mr-1 font-medium">{`${count} selected`}</span>
            {copy && copy.rows.length > 0 && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={button}
                        >
                            Copy as
                            <ChevronDown className="size-3" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        {COPY_FORMATS.map((format) => (
                            <DropdownMenuItem
                                key={format}
                                onSelect={() => void copyRows(format, copy)}
                            >
                                {format}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
            {remove && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={
                        remove.restore
                            ? button
                            : `${button} text-destructive hover:text-destructive`
                    }
                    onClick={remove.onSelect}
                >
                    {`${remove.restore ? 'Restore' : 'Delete'} ${rowsLabel(remove.count)}`}
                </Button>
            )}
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`${button} ml-auto`}
                onClick={onClear}
            >
                Clear
            </Button>
        </div>
    );
}
