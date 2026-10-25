import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/react', () => ({
    Link: ({
        href,
        children,
        ...rest
    }: {
        href: string;
        children: ReactNode;
    }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const prefetchWorkspace = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prefetch-workspace', () => ({ prefetchWorkspace }));

import { RecentQueries } from '@/components/sidebar/recent-queries';
import { SidebarProvider } from '@/components/ui/sidebar';

const minutesAgo = (m: number) =>
    new Date(Date.now() - m * 60_000).toISOString();

const items = [
    {
        id: 41,
        connection_id: 3,
        connection_name: 'Shipitlah',
        color: '#e8590c',
        sql: '  select status, count(*) FROM orders\nGROUP BY status',
        created_at: minutesAgo(12),
    },
    {
        id: 40,
        connection_id: 7,
        connection_name: 'Continental',
        color: null,
        sql: 'UPDATE couriers SET active = 1',
        created_at: minutesAgo(90),
    },
];

function renderQueries(open = true, list = items) {
    return render(
        <SidebarProvider defaultOpen={open}>
            <RecentQueries items={list} />
        </SidebarProvider>,
    );
}

describe('RecentQueries', () => {
    beforeEach(() => prefetchWorkspace.mockClear());

    it('warms only the workspace chunks on hover or focus, never an Inertia prefetch (which would mark it opened)', () => {
        renderQueries();
        const link = screen.getByRole('link', { name: /status, count/ });
        expect(link).not.toHaveAttribute('prefetch');
        fireEvent.mouseEnter(link);
        fireEvent.focus(link);
        expect(prefetchWorkspace).toHaveBeenCalledTimes(2);
    });

    it('links each entry to its history deep link and "All" to the history page', () => {
        renderQueries();
        expect(
            screen.getByRole('link', { name: /status, count/ }),
        ).toHaveAttribute('href', '/c/3?history=41');
        expect(screen.getByRole('link', { name: /couriers/ })).toHaveAttribute(
            'href',
            '/c/7?history=40',
        );
        expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute(
            'href',
            '/history',
        );
    });

    it('shows the first line with its leading keyword in a primary span, then connection and age', () => {
        renderQueries();
        const first = screen.getByRole('link', { name: /status, count/ });
        const code = first.querySelector('code')!;
        expect(code.querySelector('.text-primary')).toHaveTextContent(
            /^select$/,
        );
        expect(code).toHaveTextContent('select status, count(*) FROM orders');
        expect(code).not.toHaveTextContent('GROUP BY');
        expect(first).toHaveTextContent('Shipitlah · 12 minutes ago');
        expect(
            screen.getByRole('link', { name: /couriers/ }),
        ).toHaveTextContent('Continental · 1 hour ago');
    });

    it('falls back to the universe accent when a connection has no colour', () => {
        renderQueries();
        const square = screen
            .getByRole('link', { name: /couriers/ })
            .querySelector<HTMLElement>('[data-slot="connection-dot"]')!;
        expect(square.style.background).toBe('var(--universe-accent)');
    });

    it('renders nothing without history', () => {
        renderQueries(true, []);
        expect(screen.queryByText('Recent queries')).toBeNull();
    });

    it('is not rendered while the sidebar is collapsed to icons', () => {
        renderQueries(false);
        expect(screen.queryByText('Recent queries')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });
});
