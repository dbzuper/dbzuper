import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every prop each Link received, so tests can see props React would drop from the DOM (like `prefetch`).
const linkProps = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('@inertiajs/react', () => ({
    Link: ({
        href,
        children,
        prefetch: _prefetch,
        ...rest
    }: {
        href: string;
        children: ReactNode;
        prefetch?: unknown;
    }) => {
        linkProps.push({ href, prefetch: _prefetch, ...rest });
        return (
            <a href={href} {...rest}>
                {children}
            </a>
        );
    },
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
        database: null,
        color: '#e8590c',
        sql: '  select status, count(*) FROM orders\nGROUP BY status',
        created_at: minutesAgo(12),
    },
    {
        id: 40,
        connection_id: 7,
        connection_name: 'Continental',
        database: 'shop staging',
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
    beforeEach(() => {
        prefetchWorkspace.mockClear();
        linkProps.length = 0;
    });

    it('warms only the workspace chunks on hover or focus, never an Inertia prefetch (which would mark it opened)', () => {
        renderQueries();
        const link = screen.getByRole('link', { name: /status, count/ });
        const workspaceLinks = linkProps.filter((p) =>
            String(p.href).startsWith('/c/'),
        );
        expect(workspaceLinks.length).toBeGreaterThan(0);
        for (const p of workspaceLinks) expect(p.prefetch).toBeUndefined();
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
            '/c/7/shop%20staging?history=40',
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
