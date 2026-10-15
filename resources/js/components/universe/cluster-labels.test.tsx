import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SchemaGraph } from '@/universe/graph';
import { useWorkspace } from '@/universe/store';
import { ClusterLabels } from './cluster-labels';

const sigma = {
    graphToViewport: () => ({ x: 10, y: 20 }),
    on: () => undefined,
    removeListener: () => undefined,
} as unknown as Parameters<typeof ClusterLabels>[0]['sigma'];
const graph = {
    getNodeAttributes: () => ({ x: 0, y: 0, rows: 5 }),
} as unknown as SchemaGraph;

beforeEach(() => {
    useWorkspace.getState().reset();
    useWorkspace.getState().setZoomLevel('galaxy');
});

describe('ClusterLabels', () => {
    it('writes the name in the foreground colour beside a cluster-colour swatch', () => {
        render(
            <ClusterLabels
                sigma={sigma}
                graph={graph}
                clusters={[
                    {
                        id: 'c1',
                        label: 'orders',
                        color: '#c084fc',
                        members: ['orders', 'order_items'],
                        outer: false,
                    },
                ]}
            />,
        );
        const name = screen.getByText('orders');
        expect(name).toHaveClass('text-foreground');
        expect(name.style.color).toBe('');
        expect(screen.getByTestId('cluster-swatch-c1')).toHaveStyle({
            backgroundColor: '#c084fc',
        });
    });
});
