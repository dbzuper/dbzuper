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

const camera = {
    state: { x: 0.5, y: 0.5, angle: 0, ratio: 1 },
    getState() {
        return { ...this.state };
    },
    setState: vi.fn(function (
        this: { state: Record<string, number> },
        s: Record<string, number>,
    ) {
        this.state = { ...this.state, ...s };
    }),
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
        // One viewport pixel = 0.01 graph units, y unflipped, for easy arithmetic.
        viewportToFramedGraph: (p: { x: number; y: number }) => ({
            x: p.x / 100,
            y: p.y / 100,
        }),
        getCamera: () => camera,
    };
    return { sigma: sigma as unknown as UniverseSigma, raw: sigma, listeners };
}

const snapshot = makeSnapshot([{ name: 'a' }, { name: 'b' }, { name: 'far' }]);

afterEach(() => {
    useWorkspace.getState().reset();
    camera.state = { x: 0.5, y: 0.5, angle: 0, ratio: 1 };
    camera.setState.mockClear();
});

const pointer = (
    type: string,
    target: Element,
    x: number,
    y: number,
    button = 0,
) =>
    target.dispatchEvent(
        new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button,
        }),
    );

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

    it('pans the camera when a drag starts on a card, without selecting it', () => {
        useWorkspace.getState().setZoomLevel('closeup');
        const { sigma } = fakeSigma();
        render(<TableCards sigma={sigma} snapshot={snapshot} />);
        const card = screen.getByRole('button', { name: 'Table a' });
        act(() => {
            pointer('pointerdown', card, 100, 100);
            pointer('pointermove', card, 150, 120);
            pointer('pointermove', card, 200, 140);
            pointer('pointerup', card, 200, 140);
            pointer('click', card, 200, 140);
        });
        // Dragging right/down by (100, 40) px moves the camera left/up by (1, 0.4) graph units.
        expect(camera.state.x).toBeCloseTo(-0.5);
        expect(camera.state.y).toBeCloseTo(0.1);
        expect(useWorkspace.getState().selected).toBeNull();
    });

    it('still treats a press that moves less than 4 px as a click', () => {
        useWorkspace.getState().setZoomLevel('closeup');
        const { sigma } = fakeSigma();
        render(<TableCards sigma={sigma} snapshot={snapshot} />);
        const card = screen.getByRole('button', { name: 'Table b' });
        act(() => {
            pointer('pointerdown', card, 100, 100);
            pointer('pointermove', card, 102, 102);
            pointer('pointerup', card, 102, 102);
            pointer('click', card, 102, 102);
        });
        expect(camera.setState).not.toHaveBeenCalled();
        expect(useWorkspace.getState().selected).toBe('b');
    });

    it('completes a pending path when a card is clicked', () => {
        useWorkspace.getState().setZoomLevel('closeup');
        useWorkspace.getState().startPath('a');
        const { sigma } = fakeSigma();
        render(<TableCards sigma={sigma} snapshot={snapshot} />);
        act(
            () =>
                void pointer(
                    'click',
                    screen.getByRole('button', { name: 'Table b' }),
                    0,
                    0,
                ),
        );
        expect(useWorkspace.getState().pathTo).toBe('b');
        expect(useWorkspace.getState().selected).toBeNull();
    });

    it('keeps panning when the cards re-render mid-drag', () => {
        useWorkspace.getState().setZoomLevel('closeup');
        const { sigma } = fakeSigma();
        render(<TableCards sigma={sigma} snapshot={snapshot} />);
        const card = screen.getByRole('button', { name: 'Table a' });
        act(() => {
            pointer('pointerdown', card, 100, 100);
            pointer('pointermove', card, 150, 100);
        });
        // Any store change that re-renders the overlay (a card entering view, a selection...).
        act(() => useWorkspace.getState().select('b'));
        act(() => {
            pointer('pointermove', card, 200, 100);
            pointer('pointerup', card, 200, 100);
            pointer('click', card, 200, 100);
        });
        expect(camera.state.x).toBeCloseTo(-0.5);
        expect(useWorkspace.getState().selected).toBe('b');
    });
});
