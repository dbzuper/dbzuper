import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/react', () => ({
    Head: () => null,
    Link: ({ href, children }: { href: unknown; children: ReactNode }) => (
        <a href={String(href)}>{children}</a>
    ),
    router: { delete: vi.fn(), visit: vi.fn() },
    useForm: () => ({
        data: {},
        setData: vi.fn(),
        errors: {},
        processing: false,
        post: vi.fn(),
        put: vi.fn(),
    }),
    usePage: () => ({
        url: '/connections/create',
        props: {
            name: 'DBSuperb',
            sidebarOpen: true,
            auth: { user: { name: 'Admin', email: 'a@b.c' } },
        },
    }),
}));
vi.mock('@/components/connections/connection-form', () => ({
    ConnectionForm: () => <form aria-label="connection form" />,
}));

import { TooltipProvider } from '@/components/ui/tooltip';
import AppLayout from '@/layouts/app-layout';
import ConnectionFormPage from '@/pages/connections/form';
import type { ConnectionSummary } from '@/types/connection';

type LayoutFn = (props: { connection: ConnectionSummary | null }) => {
    breadcrumbs: { title: string; href: string }[];
};
const layout = (ConnectionFormPage as unknown as { layout: LayoutFn }).layout;

describe('connection form page layout', () => {
    it('derives its breadcrumb from the page props', () => {
        expect(layout({ connection: null }).breadcrumbs.at(-1)?.title).toBe(
            'New connection',
        );
        expect(
            layout({
                connection: { name: 'Shop' } as ConnectionSummary,
            }).breadcrumbs.at(-1)?.title,
        ).toBe('Edit Shop');
    });

    it('renders exactly one sidebar and heading inside the app layout', () => {
        const { container } = render(
            <TooltipProvider>
                <AppLayout
                    breadcrumbs={layout({ connection: null }).breadcrumbs}
                >
                    <ConnectionFormPage connection={null} drivers={[]} />
                </AppLayout>
            </TooltipProvider>,
        );
        expect(
            container.querySelectorAll('[data-slot="sidebar-wrapper"]'),
        ).toHaveLength(1);
        expect(container.querySelectorAll('h1')).toHaveLength(1);
    });
});
