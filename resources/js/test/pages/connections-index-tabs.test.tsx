import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/react', () => ({
    Head: () => null,
    Link: ({ href, children }: { href: unknown; children: ReactNode }) => (
        <a href={String(href)}>{children}</a>
    ),
    router: { delete: vi.fn(), visit: vi.fn() },
    usePage: () => ({ props: { auth: { user: { name: 'Admin' } } } }),
}));

vi.mock('@/components/connections/star-map', () => ({
    StarMap: () => null,
}));

import ConnectionsIndex from '@/pages/connections/index';
import { flushSqlTabs, useSqlTabs } from '@/sql/tabs-store';
import type { ConnectionCard } from '@/types/connection';

const connection = (id: number): ConnectionCard => ({
    id,
    ref: String(id),
    name: `Conn ${id}`,
    driver: 'sqlite',
    driver_label: 'SQLite',
    host: null,
    port: null,
    database: '/x.sqlite',
    database_label: '/x.sqlite',
    username: null,
    has_password: false,
    options: {},
    read_only: false,
    color: null,
    store_history: true,
    last_opened_at: null,
    server_level: false,
    last_database: null,
    tables: null,
    views: null,
    snapshot_at: null,
    pins: [],
    star: null,
});

describe('connections index', () => {
    beforeEach(() => {
        useSqlTabs.setState({ byConnection: {} });
        flushSqlTabs();
    });

    it('drops SQL tabs of connections that no longer exist', () => {
        useSqlTabs.getState().ensure('1');
        useSqlTabs.getState().ensure('2');

        render(<ConnectionsIndex connections={[connection(2)]} />);

        expect(Object.keys(useSqlTabs.getState().byConnection)).toEqual(['2']);
    });
});
