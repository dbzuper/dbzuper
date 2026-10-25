import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/react', () => ({
    Head: () => null,
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
    router: { delete: vi.fn(), visit: vi.fn() },
    usePage: () => ({
        url: '/connections',
        props: {
            name: 'DBSuperb',
            sidebarOpen: true,
            auth: { user: { name: 'Admin', email: 'a@b.c' } },
        },
    }),
}));

// jsdom has no canvas; the star maps are covered by their own tests.
vi.mock('@/components/connections/star-map', () => ({
    StarMap: () => null,
}));

import { TooltipProvider } from '@/components/ui/tooltip';
import AppLayout from '@/layouts/app-layout';
import ConnectionsIndex from '@/pages/connections/index';

describe('connections page layout', () => {
    it('does not wrap itself in a layout and declares its breadcrumbs', () => {
        const { container } = render(<ConnectionsIndex connections={[]} />);
        expect(container.querySelector('[data-slot="sidebar"]')).toBeNull();
        expect(
            (
                ConnectionsIndex as unknown as {
                    layout: { breadcrumbs: unknown[] };
                }
            ).layout.breadcrumbs,
        ).toHaveLength(1);
    });

    it('renders exactly one sidebar, one heading and one appearance menu inside the app layout', () => {
        const { container } = render(
            <TooltipProvider>
                <AppLayout breadcrumbs={[]}>
                    <ConnectionsIndex connections={[]} />
                </AppLayout>
            </TooltipProvider>,
        );
        expect(
            container.querySelectorAll('[data-slot="sidebar-wrapper"]'),
        ).toHaveLength(1);
        expect(
            container.querySelectorAll('[data-slot="sidebar"]'),
        ).toHaveLength(1);
        expect(container.querySelectorAll('h1')).toHaveLength(1);
        expect(
            container.querySelectorAll('[aria-label="Appearance"]'),
        ).toHaveLength(1);
        // It lives in the header bar now, not the sidebar footer.
        expect(
            container.querySelector('header [aria-label="Appearance"]'),
        ).not.toBeNull();
    });
});
