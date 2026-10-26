import { Link } from '@inertiajs/react';
import {
    dotColor,
    useSidebarExpanded,
} from '@/components/sidebar/use-sidebar-expanded';
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import { workspaceUrl } from '@/lib/connections';
import { formatSnapshotAge } from '@/lib/format';
import { prefetchWorkspace } from '@/lib/prefetch-workspace';

export type RecentQuery = {
    id: number;
    connection_id: number;
    connection_name: string;
    /** The database of a server-level connection it ran on, else null. */
    database: string | null;
    color: string | null;
    sql: string;
    created_at: string;
};

/** The first non-blank line of the SQL, split into its leading keyword and the rest. */
function firstLine(sql: string): { keyword: string; rest: string } {
    const line =
        sql
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l !== '') ?? '';
    const match = /^[A-Za-z]+/.exec(line);
    if (!match) return { keyword: '', rest: line };
    return { keyword: match[0], rest: line.slice(match[0].length) };
}

/** The user's newest history entries across connections, each opening its workspace on that entry. */
export function RecentQueries({ items }: { items: RecentQuery[] }) {
    const expanded = useSidebarExpanded();
    if (!expanded || items.length === 0) return null;

    return (
        <SidebarGroup className="px-2 py-0 group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel className="justify-between">
                <span>Recent queries</span>
                <Link
                    href="/history"
                    className="rounded-sm px-1 text-xs font-normal text-muted-foreground ring-sidebar-ring outline-hidden hover:text-foreground focus-visible:ring-2"
                >
                    All
                </Link>
            </SidebarGroupLabel>
            <SidebarMenu className="gap-0.5">
                {items.map((q) => {
                    const { keyword, rest } = firstLine(q.sql);
                    return (
                        <SidebarMenuItem key={q.id}>
                            <Link
                                href={`${workspaceUrl(q.connection_id, q.database)}?history=${q.id}`}
                                onMouseEnter={prefetchWorkspace}
                                onFocus={prefetchWorkspace}
                                className="grid grid-cols-[0.5rem_minmax(0,1fr)] gap-x-2 rounded-md px-2 py-1.5 text-sidebar-foreground ring-sidebar-ring outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2"
                            >
                                <span
                                    data-slot="connection-dot"
                                    aria-hidden
                                    className="mt-1.5 size-2 rounded-[2px]"
                                    style={{ background: dotColor(q.color) }}
                                />
                                <code className="block truncate font-mono text-[11.5px] leading-snug">
                                    {keyword && (
                                        <span className="font-medium text-primary">
                                            {keyword}
                                        </span>
                                    )}
                                    {rest}
                                </code>
                                <small className="col-start-2 truncate text-[11px] text-muted-foreground">
                                    {q.connection_name} ·{' '}
                                    {formatSnapshotAge(q.created_at)}
                                </small>
                            </Link>
                        </SidebarMenuItem>
                    );
                })}
            </SidebarMenu>
        </SidebarGroup>
    );
}
