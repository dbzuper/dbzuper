import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useWorkspace } from '@/universe/store';
import { TableCards } from './table-cards';
import type { UniverseSigma } from './universe-canvas';

const nodes: Record<string, { x: number; y: number }> = {
    a: { x: 100, y: 100 },
    b: { x: 300, y: 200 },
    far: { x: 9000, y: 9000 },
};

function fakeSigma() {
    const listeners = new Set<() => void>();
    const sigma = {
        on: vi.fn((_e: string, fn: () => void) => listeners.add(fn)),
        removeListener: vi.fn((_e: string, fn: () => void) =>
            listeners.delete(fn),
        ),
        getGraph: () => ({
            hasNode: (k: string) => k in nodes,
            getNodeAttributes: (k: string) => nodes[k],
            forEachNode: (
                cb: (k: string, a: { x: number; y: number }) => void,
            ) => Object.entries(nodes).forEach(([k, a]) => cb(k, a)),
        }),
        getDimensions: () => ({ width: 800, height: 600 }),
        graphToViewport: (p: { x: number; y: number }) => p,
        getNodeDisplayData: () => ({ visibility: 'visible' }),
        getMouseLayer: () => document.createElement('div'),
    };
    return { sigma: sigma as unknown as UniverseSigma, raw: sigma, listeners };
}

const snapshot = makeSnapshot([{ name: 'a' }, { name: 'b' }, { name: 'far' }]);

afterEach(() => useWorkspace.getState().setZoomLevel('system'));

describe('TableCards', () => {
    it('renders cards for in-viewport nodes at close zoom and detaches on unmount', () => {
        useWorkspace.getState().setZoomLevel('closeup');
        const { sigma, raw, listeners } = fakeSigma();
        const { unmount } = render(
            <TableCards sigma={sigma} snapshot={snapshot} />,
        );
        expect(
            screen.getByRole('button', { name: 'Table a' }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Table b' }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Table far' }),
        ).not.toBeInTheDocument();
        expect(listeners.size).toBe(1);
        unmount();
        expect(raw.removeListener).toHaveBeenCalledWith(
            'afterRender',
            expect.any(Function),
        );
        expect(listeners.size).toBe(0);
    });

    it('renders nothing unless zoomed close', () => {
        const { sigma } = fakeSigma();
        render(<TableCards sigma={sigma} snapshot={snapshot} />);
        expect(screen.queryAllByRole('button')).toHaveLength(0);
        act(() => useWorkspace.getState().setZoomLevel('closeup'));
        expect(screen.getAllByRole('button')).toHaveLength(2);
    });
});
