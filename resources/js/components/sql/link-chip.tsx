import { ChevronDown, Link2, Link2Off } from 'lucide-react';
import { updateSqlFromTable } from '@/browse/sql-link';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSqlTabs, type SqlTab } from '@/sql/tabs-store';
import type { Dialect } from '@/types/schema';

const Title = ({ children }: { children: string }) => (
    <span className="font-mono text-foreground">{children}</span>
);

/**
 * The active editor tab's link to a table tab (spec 4.2): "Linked to …" with a menu, "… changed · Update SQL" when
 * the table moved on while the text was edited, or a muted note once the table tab was closed.
 */
export function LinkChip({
    connectionId,
    tab,
    dialect,
}: {
    connectionId: number;
    tab: SqlTab;
    dialect: Dialect;
}) {
    const link = tab.link;
    if (!link) return null;

    if (link.closed)
        return (
            <span
                role="status"
                className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground"
            >
                <Link2Off className="size-3.5 shrink-0" aria-hidden />
                Unlinked: <Title>{link.title}</Title> was closed
            </span>
        );

    if (link.stale)
        return (
            <span className="flex min-w-0 items-center gap-1.5 text-xs">
                <span
                    role="status"
                    className="flex min-w-0 items-center gap-1 truncate text-muted-foreground"
                >
                    <Link2 className="size-3.5 shrink-0" aria-hidden />
                    <Title>{link.title}</Title> changed
                </span>
                <span aria-hidden className="text-muted-foreground">
                    ·
                </span>
                <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    title="Replace the editor text with the table tab's query (Ctrl/⌘+Z undoes it)"
                    onClick={() =>
                        updateSqlFromTable(
                            connectionId,
                            link.browseTabId,
                            dialect,
                        )
                    }
                >
                    Update SQL
                </Button>
            </span>
        );

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 min-w-0 gap-1 px-2 text-xs text-muted-foreground"
                    title="Fitting statements run here set this table tab's filters, sort and page"
                >
                    <Link2 className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">
                        Linked to <Title>{link.title}</Title>
                    </span>
                    <ChevronDown className="size-3.5 shrink-0" aria-hidden />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
                <DropdownMenuItem
                    onSelect={() =>
                        useSqlTabs.getState().openTab(connectionId, tab.sql)
                    }
                >
                    Copy to new tab
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={() =>
                        useSqlTabs
                            .getState()
                            .setLink(connectionId, tab.id, undefined)
                    }
                >
                    Unlink
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
