import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clusterKey, useRecords } from '@/records/records-store';
import { openRoot, nodeId } from '@/records/trail';
import type { RelationshipSummary } from '@/records/types';
import { useWorkspace } from '@/universe/store';
import { ClusterNode } from './cluster-node';

const summary: RelationshipSummary = {
    id: 'fk',
    direction: 'in',
    table: 'order_items',
    columns: ['order_id', 'shop_id'],
    other_columns: ['id', 'shop'],
    inferred: false,
    available: true,
    count: { value: 30, capped: false },
};
const root = nodeId('orders', { id: 1, shop: 2 });
const key = clusterKey(root, 'fk', 'in');

function mount(remaining: number | null) {
    useRecords.setState({
        trail: openRoot('orders', { id: 1, shop: 2 }),
        records: {
            [root]: {
                status: 'ready',
                payload: {
                    table: 'orders',
                    key: { id: 1, shop: 2 },
                    columns: [
                        { name: 'id', type: 'int' },
                        { name: 'shop', type: 'int' },
                    ],
                    values: [1, 2],
                    relationships: [],
                },
            },
        },
        clusters: {
            [key]: {
                from: root,
                table: 'order_items',
                summary,
                remaining,
                cursor: 'c',
                edgeCount: 25,
                loading: false,
            },
        },
    });
    const props = {
        id: 'cluster:x',
        data: { key },
    } as unknown as React.ComponentProps<typeof ClusterNode>;
    render(
        <ReactFlowProvider>
            <ClusterNode {...props} />
        </ReactFlowProvider>,
    );
}

beforeEach(() => {
    useRecords.getState().reset();
    useWorkspace.getState().reset();
});

describe('ClusterNode', () => {
    it('shows how many are left', () => {
        mount(5);
        expect(screen.getByText('+5 more order_items')).toBeInTheDocument();
    });

    it('shows a generic label when the remainder is unknown', () => {
        mount(null);
        expect(screen.getByText('More order_items')).toBeInTheDocument();
    });

    it('never shows +0 more', () => {
        mount(0);
        expect(screen.getByText('More order_items')).toBeInTheDocument();
    });

    it('Add next 25 asks the store for the next page', () => {
        mount(5);
        const more = vi.fn();
        useRecords.setState({ more });
        fireEvent.click(
            screen.getByRole('button', { name: 'Add next 25 order_items' }),
        );
        expect(more).toHaveBeenCalledWith(key);
    });

    it('Open in Data tab filters on every key column without changing the view', () => {
        mount(5);
        fireEvent.click(
            screen.getByRole('button', { name: 'Open in Data tab' }),
        );
        const ws = useWorkspace.getState();
        expect(ws.view).toBe('universe');
        expect(ws.selected).toBe('order_items');
        expect(ws.inspectorTab).toBe('data');
        expect(ws.dataFilter).toEqual({
            table: 'order_items',
            filters: [
                { column: 'order_id', value: '1' },
                { column: 'shop_id', value: '2' },
            ],
        });
    });
});
