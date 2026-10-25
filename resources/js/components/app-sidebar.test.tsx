import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const page = vi.hoisted(() => ({
    props: {} as Record<string, unknown>,
}));

vi.mock('@inertiajs/react', () => ({
    Link: ({
        href,
        children,
        ...rest
    }: {
        href: unknown;
        children: ReactNode;
    }) => (
        <a href={String(href)} {...rest}>
            {children}
        </a>
    ),
    router: { post: vi.fn(), flushAll: vi.fn() },
    usePage: () => ({ url: '/connections', props: page.props }),
}));

import { AppSidebar } from '@/components/app-sidebar';
import { AppSidebarHeader } from '@/components/app-sidebar-header';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

const sidebar = {
    recentConnections: [
        { id: 3, name: 'Shipitlah', color: '#e8590c', driver_label: 'MySQL' },
    ],
    recentQueries: [
        {
            id: 41,
            connection_id: 3,
            connection_name: 'Shipitlah',
            color: '#e8590c',
            sql: 'SELECT 1',
            created_at: new Date().toISOString(),
        },
    ],
};

function renderShell(open = true) {
    return render(
        <TooltipProvider>
            <SidebarProvider defaultOpen={open}>
                <AppSidebar />
                <main>
                    <AppSidebarHeader breadcrumbs={[]} />
                </main>
            </SidebarProvider>
        </TooltipProvider>,
    );
}

beforeEach(() => {
    localStorage.clear();
    page.props = {
        name: 'DBZuper',
        auth: { user: { name: 'Admin', email: 'a@b.c' } },
        sidebarOpen: true,
        sidebar,
    };
});

describe('app shell', () => {
    it('puts the Appearance button in the header bar, not the sidebar footer', () => {
        const { container } = renderShell();
        const header = container.querySelector('header')!;
        expect(
            within(header).getByRole('button', { name: 'Appearance' }),
        ).toBeInTheDocument();
        const footer = container.querySelector<HTMLElement>(
            '[data-slot="sidebar-footer"]',
        )!;
        expect(
            within(footer).queryByRole('button', { name: 'Appearance' }),
        ).toBeNull();
        expect(
            screen.getAllByRole('button', { name: 'Appearance' }),
        ).toHaveLength(1);
    });

    it('shows Recent, Recent queries and the tip card in the expanded sidebar', () => {
        renderShell();
        expect(screen.getByText('Recent')).toBeInTheDocument();
        expect(screen.getByText('Recent queries')).toBeInTheDocument();
        expect(screen.getByTestId('tip-text')).toBeInTheDocument();
    });

    it('hides all three sections when the sidebar is collapsed to icons', () => {
        renderShell(false);
        expect(screen.queryByText('Recent')).toBeNull();
        expect(screen.queryByText('Recent queries')).toBeNull();
        expect(screen.queryByTestId('tip-text')).toBeNull();
    });

    it('copes without shared sidebar data', () => {
        page.props = { ...page.props, sidebar: null };
        renderShell();
        expect(screen.queryByText('Recent')).toBeNull();
        expect(screen.queryByText('Recent queries')).toBeNull();
        expect(screen.getByTestId('tip-text')).toBeInTheDocument();
    });
});
