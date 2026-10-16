import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/react', () => ({
    Head: () => null,
    Link: ({ href, children }: { href: unknown; children: ReactNode }) => (
        <a href={String(href)}>{children}</a>
    ),
    router: { delete: vi.fn(), visit: vi.fn() },
}));

import ConnectionsIndex from '@/pages/connections/index';
import { flushSqlTabs, useSqlTabs } from '@/sql/tabs-store';
import type { ConnectionSummary } from '@/types/connection';

const connection = (id: number): ConnectionSummary => ({
    id,
    name: `Conn ${id}`,
    driver: 'sqlite',
    driver_label: 'SQLite',
    host: null,
    port: null,
    database: '/x.sqlite',
    username: null,
    has_password: false,
    options: {},
    read_only: false,
    color: null,
    store_history: true,
});

describe('connections index', () => {
    beforeEach(() => {
        useSqlTabs.setState({ byConnection: {} });
        flushSqlTabs();
    });

    it('drops SQL tabs of connections that no longer exist', () => {
        useSqlTabs.getState().ensure(1);
        useSqlTabs.getState().ensure(2);

        render(<ConnectionsIndex connections={[connection(2)]} />);

        expect(Object.keys(useSqlTabs.getState().byConnection)).toEqual(['2']);
    });
});
