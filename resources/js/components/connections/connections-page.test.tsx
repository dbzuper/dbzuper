import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerDelete = vi.fn();

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
    router: { delete: (...args: unknown[]) => routerDelete(...args) },
    usePage: () => ({
        props: { auth: { user: { name: 'Farhan Ahmad', email: 'f@x.y' } } },
    }),
}));

vi.mock('@/components/connections/star-map', () => ({
    StarMap: () => <canvas aria-hidden />,
}));

import ConnectionsIndex from '@/pages/connections/index';
import type { ConnectionCard } from '@/types/connection';

const NOW = new Date(2026, 9, 25, 9, 0, 0);
const ago = (minutes: number) =>
    new Date(NOW.getTime() - minutes * 60_000).toISOString();

function card(over: Partial<ConnectionCard>): ConnectionCard {
    return {
        id: 1,
        name: 'Conn',
        driver: 'mysql',
        driver_label: 'MySQL',
        host: '127.0.0.1',
        port: 3306,
        database: 'db',
        username: 'root',
        has_password: false,
        options: {},
        read_only: false,
        color: null,
        store_history: true,
        last_opened_at: null,
        tables: null,
        views: null,
        snapshot_at: null,
        pins: [],
        star: null,
        ...over,
    };
}

const fixtures: ConnectionCard[] = [
    card({
        id: 1,
        name: 'Shipitlah Production',
        port: 13306,
        database: 'shipitlah',
        read_only: true,
        color: '#e8590c',
        tables: 172,
        views: 4,
        snapshot_at: ago(12),
        last_opened_at: ago(12),
        pins: ['orders', 'shipments', 'couriers', 'users', 'zones'],
    }),
    card({
        id: 2,
        name: 'Continental localhost',
        database: 'continental',
        tables: 48,
        views: 0,
        snapshot_at: ago(2 * 1440),
        last_opened_at: ago(1440),
    }),
    card({
        id: 3,
        name: 'Test SQLite',
        driver: 'sqlite',
        driver_label: 'SQLite',
        host: null,
        port: null,
        database: '/data/commerce.sqlite',
        username: null,
    }),
];

const cards = () => screen.queryAllByRole('article');
const search = () => screen.getByPlaceholderText('Find a connection');

describe('connections page', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        localStorage.clear();
        routerDelete.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('greets by time of day with the first name', () => {
        render(<ConnectionsIndex connections={fixtures} />);
        expect(screen.getByText('Good morning, Farhan')).toBeInTheDocument();
        expect(
            screen.getByRole('heading', { level: 1, name: 'Your databases' }),
        ).toBeInTheDocument();
    });

    it('sums tables, counts engines and names the last opened connection', () => {
        render(<ConnectionsIndex connections={fixtures} />);
        const summary = screen.getByRole('list', { name: 'Summary' });
        expect(summary).toHaveTextContent('3 connections');
        expect(summary).toHaveTextContent('220 tables mapped');
        expect(summary).toHaveTextContent('2 engines');
        expect(summary).toHaveTextContent(
            'last opened Shipitlah Production · 12 minutes ago',
        );
    });

    it('filters cards as you type', () => {
        render(<ConnectionsIndex connections={fixtures} />);
        fireEvent.change(search(), { target: { value: 'ship' } });
        expect(cards()).toHaveLength(1);
        expect(cards()[0]).toHaveTextContent('Shipitlah Production');
    });

    it('shows a no-match message with Clear', () => {
        render(<ConnectionsIndex connections={fixtures} />);
        fireEvent.change(search(), { target: { value: 'zzz' } });
        expect(cards()).toHaveLength(0);
        expect(
            screen.getByText('No connection matches "zzz"'),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(cards()).toHaveLength(3);
        expect(search()).toHaveValue('');
    });

    it('focuses search on / unless another input has focus', () => {
        render(<ConnectionsIndex connections={fixtures} />);
        document.body.focus();
        const notPrevented = fireEvent.keyDown(document.body, { key: '/' });
        expect(notPrevented).toBe(false);
        expect(search()).toHaveFocus();

        const other = document.createElement('input');
        document.body.appendChild(other);
        other.focus();
        expect(fireEvent.keyDown(other, { key: '/' })).toBe(true);
        expect(other).toHaveFocus();
        other.remove();
    });

    it('switches to the list view and remembers it', () => {
        const { unmount } = render(<ConnectionsIndex connections={fixtures} />);
        fireEvent.click(screen.getByRole('button', { name: 'List view' }));
        expect(cards()).toHaveLength(0);
        const list = screen.getByRole('list', { name: 'Connections' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
        expect(localStorage.getItem('dbsuperb.connections-view')).toBe('list');
        expect(
            screen.getByRole('button', { name: 'List view' }),
        ).toHaveAttribute('aria-pressed', 'true');

        unmount();
        render(<ConnectionsIndex connections={fixtures} />);
        expect(
            screen.getByRole('list', { name: 'Connections' }),
        ).toBeInTheDocument();
    });

    it('shows the empty state without the summary or tools', () => {
        render(<ConnectionsIndex connections={[]} />);
        expect(
            screen.getByText('Connect your first database'),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Point DBSuperb at MySQL, MariaDB, PostgreSQL/),
        ).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Summary' })).toBeNull();
        expect(screen.queryByPlaceholderText('Find a connection')).toBeNull();
        expect(
            screen.getAllByRole('link', { name: /New connection/ }),
        ).toHaveLength(1);
    });

    it('marks unmapped connections and caps pin chips at four', () => {
        render(<ConnectionsIndex connections={fixtures} />);
        const [ship, , sqlite] = cards();
        expect(sqlite).toHaveTextContent('not mapped yet');
        expect(sqlite).toHaveTextContent('No pinned tables yet');
        expect(sqlite).toHaveTextContent('commerce.sqlite');

        const pins = within(ship)
            .getAllByRole('link')
            .filter((a) => a.getAttribute('href')?.includes('?tab='));
        expect(pins).toHaveLength(4);
        expect(pins[0]).toHaveAttribute('href', '/c/1?tab=orders');
        expect(ship).toHaveTextContent('+1 more');
        expect(ship).toHaveTextContent('read-only');
    });

    it('removes a connection from the menu after confirming', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<ConnectionsIndex connections={fixtures} />);
        fireEvent.keyDown(
            screen.getByRole('button', {
                name: 'More actions for Shipitlah Production',
            }),
            { key: 'Enter' },
        );
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
        expect(confirm).toHaveBeenCalledWith(
            'Remove the saved connection "Shipitlah Production"? The database itself is not affected.',
        );
        expect(routerDelete).toHaveBeenCalledWith('/connections/1');
    });

    it('links each card to its workspace and its edit page', () => {
        render(<ConnectionsIndex connections={fixtures} />);
        expect(
            screen.getByRole('link', { name: 'Open Test SQLite' }),
        ).toHaveAttribute('href', '/c/3');
        expect(
            screen.getByRole('link', { name: 'Edit Test SQLite' }),
        ).toHaveAttribute('href', '/connections/3/edit');
    });

    it('fills the hovered Open label and the engine glyph with a tint that keeps foreground text readable', () => {
        render(<ConnectionsIndex connections={fixtures} />);
        const [ship] = cards();
        const tint = 'bg-[color-mix(in_oklab,var(--c)_30%,var(--card))]';
        const open = within(ship).getByText('Open');
        expect(open.className).toContain(`group-hover/card:${tint}`);
        expect(open.className).not.toContain('text-background');
        const glyph = within(ship).getByText('My');
        expect(glyph.className).toContain(tint);
        expect(glyph.className).toContain('text-foreground');
        expect(ship.innerHTML).not.toContain('text-background');
    });

    it('draws the read-only chip as foreground text on a warning tint', () => {
        render(<ConnectionsIndex connections={fixtures} />);
        const chip = within(cards()[0]).getByText('read-only');
        expect(chip.className).toContain(
            'bg-[color-mix(in_oklab,var(--warning)_14%,var(--background))]',
        );
        expect(chip.className).toContain('text-foreground');
    });

    it('caps the entrance stagger at eight steps', () => {
        const many = Array.from({ length: 12 }, (_, i) =>
            card({ id: i + 1, name: `C${i + 1}` }),
        );
        render(<ConnectionsIndex connections={many} />);
        const delays = cards().map((a) => a.style.animationDelay);
        expect(delays[3]).toBe('150ms');
        expect(delays[11]).toBe('400ms');
    });
});
