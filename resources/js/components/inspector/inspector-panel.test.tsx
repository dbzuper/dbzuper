import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowse } from '@/browse/browse-store';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useWorkspace } from '@/universe/store';

const api = vi.hoisted(() => ({ ddl: vi.fn() }));
vi.mock('@/lib/workspace-api', async (orig) => ({
    ...(await orig<typeof import('@/lib/workspace-api')>()),
    workspaceApi: {
        ...api,
        schema: vi.fn(),
        refresh: vi.fn(),
        layout: vi.fn(),
        saveLayout: vi.fn(),
    },
}));

import { INSPECTOR_HEADING_ID, InspectorPanel } from './inspector-panel';
import { tableTabOf } from '@/test/browse-tabs';

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
        { name: 'order_items' },
    ],
    [
        {
            from_table: 'orders',
            to_table: 'users',
            from_columns: ['user_id'],
            inferred: true,
            confidence: 0.9,
        },
        {
            from_table: 'order_items',
            to_table: 'orders',
            from_columns: ['order_id'],
        },
    ],
    'pgsql',
);
const orders = snapshot.tables[0];

afterEach(() => {
    vi.restoreAllMocks();
    useBrowse.setState({ byConnection: {} });
});

beforeEach(() => {
    useWorkspace.getState().reset();
    api.ddl.mockResolvedValue({ ddl: null });
});

describe('InspectorPanel', () => {
    it('has a programmatically focusable heading for the command palette to land on', () => {
        render(
            <InspectorPanel
                connectionId="1"
                snapshot={snapshot}
                table={orders}
            />,
        );
        const heading = screen.getByRole('heading', { name: 'orders' });
        expect(heading).toHaveAttribute('id', INSPECTOR_HEADING_ID);
        expect(heading).toHaveAttribute('tabindex', '-1');
    });

    it('reads a power level over 9,000 rows', () => {
        const { rerender } = render(
            <InspectorPanel
                connectionId="1"
                snapshot={snapshot}
                table={orders}
            />,
        );
        expect(screen.getByText('10 rows')).not.toHaveAttribute('title');

        rerender(
            <InspectorPanel
                connectionId="1"
                snapshot={snapshot}
                table={{ ...orders, row_count: { count: 9001, kind: 'exact' } }}
            />,
        );
        expect(screen.getByText('9,001 rows')).toHaveAttribute(
            'title',
            "It's over 9,000!",
        );
    });

    it('lists columns with key markers', () => {
        render(
            <InspectorPanel
                connectionId="1"
                snapshot={snapshot}
                table={orders}
            />,
        );
        expect(
            screen.getByRole('heading', { name: 'orders' }),
        ).toBeInTheDocument();
        expect(screen.getByText('user_id')).toBeInTheDocument();
        expect(screen.getByLabelText('primary key')).toBeInTheDocument();
        expect(
            screen.getByLabelText('inferred foreign key'),
        ).toBeInTheDocument();
    });

    it('shows outgoing and incoming relationships and navigates to the other table', () => {
        useWorkspace.getState().setInspectorTab('relationships');
        render(
            <InspectorPanel
                connectionId="1"
                snapshot={snapshot}
                table={orders}
            />,
        );
        expect(screen.getByText('90% inferred')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'order_items' }));
        expect(useWorkspace.getState().selected).toBe('order_items');
    });

    it('falls back to generated DDL when the engine has none', async () => {
        useWorkspace.getState().setInspectorTab('ddl');
        render(
            <InspectorPanel
                connectionId="1"
                snapshot={snapshot}
                table={orders}
            />,
        );
        expect(await screen.findByText(/Approximate DDL/)).toBeInTheDocument();
        await waitFor(() =>
            expect(screen.getByTestId('ddl')).toHaveTextContent(
                'CREATE TABLE "orders"',
            ),
        );
    });

    it('starts the path finder and focus mode from the header', () => {
        render(
            <InspectorPanel
                connectionId="1"
                snapshot={snapshot}
                table={orders}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Find path to…' }));
        expect(useWorkspace.getState().pathFrom).toBe('orders');
        fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
        expect(useWorkspace.getState().focus).toEqual({
            table: 'orders',
            depth: 1,
        });
    });

    it('opens the table data in a tab', () => {
        render(
            <InspectorPanel
                connectionId="1"
                snapshot={snapshot}
                table={snapshot.tables[1]}
            />,
        );
        expect(screen.queryByRole('tab', { name: 'Data' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Open data' }));
        const browse = useBrowse.getState().get('1');
        expect(browse.activeId).toBe(tableTabOf('1', 'users')?.id);
        expect(tableTabOf('1', 'users')).toMatchObject({
            preview: false,
        });
    });
});
