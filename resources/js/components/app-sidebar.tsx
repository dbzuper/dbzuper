import { Link, usePage } from '@inertiajs/react';
import { History, LayoutGrid } from 'lucide-react';
import AppLogo from '@/components/app-logo';
import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import { RecentConnections } from '@/components/sidebar/recent-connections';
import { RecentQueries } from '@/components/sidebar/recent-queries';
import { TipsCard } from '@/components/sidebar/tips-card';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import type { NavItem } from '@/types';

const mainNavItems: NavItem[] = [
    {
        title: 'Connections',
        href: '/connections',
        icon: LayoutGrid,
    },
    {
        title: 'History',
        href: '/history',
        icon: History,
    },
];

export function AppSidebar() {
    const { sidebar } = usePage().props;

    return (
        <Sidebar collapsible="icon" variant="inset">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href="/connections" prefetch>
                                <AppLogo />
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                <NavMain items={mainNavItems} />
                <RecentConnections items={sidebar?.recentConnections ?? []} />
                <RecentQueries items={sidebar?.recentQueries ?? []} />
            </SidebarContent>

            <SidebarFooter>
                <TipsCard />
                <NavUser />
            </SidebarFooter>
        </Sidebar>
    );
}
