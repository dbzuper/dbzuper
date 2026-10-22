import { ChevronDown, Link2, Link2Off } from 'lucide-react';
import { useBrowse } from '@/browse/browse-store';
import { latestTableSql, updateSqlFromTable } from '@/browse/sql-link';
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
    // With its table tab open a query is always known (one is built from its state when none was reported).
    const tableOpen = useBrowse(
        (s) =>
            !!link &&
            !!s.byConnection[connectionId]?.tabs.some(
                (t) => t.id === link.browseTabId && t.kind === 'table',
            ),
    );
    if (!link) return null;
    const known =
        tableOpen ||
        latestTableSql(connectionId, link.browseTabId) !== undefined;

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
                {/* A disabled button gets no pointer events, so the reason sits on its wrapper. */}
                <span
                    title={
                        known
                            ? "Replace the editor text with the table tab's query (Ctrl/⌘+Z undoes it)"
                            : "The table tab's query isn't known, so there is nothing to update to"
                    }
                >
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        disabled={!known}
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
