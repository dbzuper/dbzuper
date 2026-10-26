import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';

const api = vi.hoisted(() => ({ ddl: vi.fn() }));
vi.mock('@/lib/workspace-api', async (orig) => ({
    ...(await orig<typeof import('@/lib/workspace-api')>()),
    workspaceApi: { ...api },
}));

import { StructureView } from './structure-view';

const snapshot = makeSnapshot(
    [
        {
            name: 'orders',
            columns: [
                {
                    name: 'id',
                    type: 'integer',
                    type_name: 'integer',
                    nullable: false,
                    default: null,
                    auto_increment: true,
                    comment: null,
                },
                {
                    name: 'user_id',
                    type: 'integer',
                    type_name: 'integer',
                    nullable: false,
                    default: null,
                    auto_increment: false,
                    comment: null,
                },
            ],
            indexes: [
                {
                    name: 'orders_user_id_index',
                    columns: ['user_id'],
                    unique: false,
                    primary: false,
                },
            ],
        },
        { name: 'users' },
    ],
    [{ from_table: 'orders', to_table: 'users', from_columns: ['user_id'] }],
    'pgsql',
);

beforeEach(() => {
    api.ddl.mockReset();
    api.ddl.mockResolvedValue({ ddl: 'CREATE TABLE orders (id integer)' });
});

describe('StructureView', () => {
    it('shows columns, indexes, relationships and DDL sections and opens related tables', async () => {
        const onOpenTable = vi.fn();
        render(
            <StructureView
                connectionId="1"
                snapshot={snapshot}
                table={snapshot.tables[0]}
                onOpenTable={onOpenTable}
            />,
        );
        for (const name of ['Columns', 'Indexes', 'Relationships', 'DDL'])
            expect(
                screen.getByRole('heading', { level: 3, name }),
            ).toBeInTheDocument();
        expect(screen.getByText('orders_user_id_index')).toBeInTheDocument();
        expect(await screen.findByTestId('ddl')).toHaveTextContent(
            'CREATE TABLE orders',
        );
        fireEvent.click(screen.getByRole('button', { name: 'users' }));
        expect(onOpenTable).toHaveBeenCalledWith('users');
    });
});
