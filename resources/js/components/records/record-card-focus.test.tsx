import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordEntry } from '@/records/records-store';
import { RecordCard } from './record-card';

const flow = vi.hoisted(() => ({
    setCenter: vi.fn(),
    getZoom: vi.fn(() => 0.8),
    getInternalNode: vi.fn(),
}));

vi.mock('@xyflow/react', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@xyflow/react')>()),
    useReactFlow: () => flow,
    useNodeId: () => 'node-1',
}));

const ready: RecordEntry = {
    status: 'ready',
    payload: {
        table: 'orders',
        key: { id: 7 },
        columns: [{ name: 'id', type: 'int' }],
        values: [7],
        relationships: [
            {
                id: 'fk',
                direction: 'out',
                table: 'users',
                columns: ['user_id'],
                other_columns: ['id'],
                inferred: false,
                available: true,
                count: null,
            },
        ],
    },
};

function renderCard() {
    render(
        <ReactFlowProvider>
            <RecordCard
                table="orders"
                recordKey={{ id: 7 }}
                entry={ready}
                selected={false}
                showInferred
                onExpand={vi.fn()}
                onSelect={vi.fn()}
                onRemove={vi.fn()}
                onReload={vi.fn()}
            />
        </ReactFlowProvider>,
    );
}

describe('RecordCard keyboard focus', () => {
    beforeEach(() => {
        flow.setCenter.mockClear();
        flow.getInternalNode.mockReset();
        flow.getInternalNode.mockReturnValue({
            internals: { positionAbsolute: { x: 100, y: 200 } },
            measured: { width: 300, height: 120 },
        });
    });

    it('pans the canvas to the card when a control inside it receives focus', () => {
        renderCard();
        fireEvent.focus(screen.getByRole('button', { name: /^Open users/ }));
        expect(flow.getInternalNode).toHaveBeenCalledWith('node-1');
        expect(flow.setCenter).toHaveBeenCalledWith(250, 260, {
            zoom: 0.8,
            duration: 200,
        });
    });

    it('does nothing when the card is not measured yet', () => {
        flow.getInternalNode.mockReturnValue(undefined);
        renderCard();
        fireEvent.focus(screen.getByRole('button', { name: /^Open users/ }));
        expect(flow.setCenter).not.toHaveBeenCalled();
    });
});
