import { Link } from '@inertiajs/react';
import { ArrowUpRight } from 'lucide-react';
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

export type RecentConnection = {
    id: number;
    name: string;
    color: string | null;
    driver_label: string;
};

/** The sidebar's most recently opened connections; hidden when none has been opened or when collapsed. */
export function RecentConnections({ items }: { items: RecentConnection[] }) {
    const expanded = useSidebarExpanded();
    if (!expanded || items.length === 0) return null;

    return (
        <SidebarGroup className="px-2 py-0 group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Recent</SidebarGroupLabel>
            <SidebarMenu className="gap-0.5">
                {items.map((c) => (
                    <SidebarMenuItem key={c.id}>
                        <Link
                            href={`/c/${c.id}`}
                            prefetch
                            className="group/rc flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground ring-sidebar-ring outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2"
                        >
                            <span
                                data-slot="connection-dot"
                                aria-hidden
                                className="size-2 shrink-0 rounded-full"
                                style={{ background: dotColor(c.color) }}
                            />
                            <span className="min-w-0 flex-1 truncate">
                                {c.name}
                            </span>
                            <span className="font-mono text-[10px] font-medium text-muted-foreground">
                                {c.driver_label}
                            </span>
                            <ArrowUpRight
                                aria-hidden
                                className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/rc:opacity-100 group-focus-visible/rc:opacity-100"
                            />
                        </Link>
                    </SidebarMenuItem>
                ))}
            </SidebarMenu>
        </SidebarGroup>
    );
}
