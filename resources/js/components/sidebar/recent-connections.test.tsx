import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

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

import { RecentConnections } from '@/components/sidebar/recent-connections';
import { SidebarProvider } from '@/components/ui/sidebar';

const items = [
    {
        id: 3,
        name: 'Shipitlah Production',
        color: '#e8590c',
        driver_label: 'MySQL',
    },
    { id: 7, name: 'Test SQLite', color: null, driver_label: 'SQLite' },
];

function renderRecent(open = true, list = items) {
    return render(
        <SidebarProvider defaultOpen={open}>
            <RecentConnections items={list} />
        </SidebarProvider>,
    );
}

describe('RecentConnections', () => {
    it('lists each connection with its engine, linking to its workspace', () => {
        renderRecent();
        expect(screen.getByText('Recent')).toBeInTheDocument();
        const ship = screen.getByRole('link', { name: /Shipitlah Production/ });
        expect(ship).toHaveAttribute('href', '/c/3');
        expect(ship).toHaveTextContent('MySQL');
        expect(
            screen.getByRole('link', { name: /Test SQLite/ }),
        ).toHaveAttribute('href', '/c/7');
    });

    it('falls back to the universe accent when a connection has no colour', () => {
        renderRecent();
        const dot = screen
            .getByRole('link', { name: /Test SQLite/ })
            .querySelector<HTMLElement>('[data-slot="connection-dot"]')!;
        expect(dot.style.background).toBe('var(--universe-accent)');
    });

    it('renders nothing when no connection has been opened', () => {
        const { container } = renderRecent(true, []);
        expect(screen.queryByText('Recent')).toBeNull();
        expect(
            container.querySelector('[data-slot="sidebar-group"]'),
        ).toBeNull();
    });

    it('is not rendered while the sidebar is collapsed to icons', () => {
        renderRecent(false);
        expect(screen.queryByText('Recent')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });
});
