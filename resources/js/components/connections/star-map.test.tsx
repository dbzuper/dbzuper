import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StarMap } from '@/components/connections/star-map';

const stopWatching = vi.fn();
let themeCb: () => void = () => {};

vi.mock('@/lib/theme-watch', () => ({
    watchThemeChanges: (cb: () => void) => {
        themeCb = cb;

        return stopWatching;
    },
}));

const disconnect = vi.fn();

class FakeResizeObserver {
    observe = vi.fn();
    disconnect = disconnect;
}

function makeCtx() {
    const fills: string[] = [];
    const strokes: string[] = [];

    return {
        fills,
        strokes,
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        arc: vi.fn(),
        beginPath: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        setTransform: vi.fn(),
        clearRect: vi.fn(),
        set fillStyle(v: string) {
            fills.push(v);
        },
        set strokeStyle(v: string) {
            strokes.push(v);
        },
        globalAlpha: 1,
        lineWidth: 1,
        shadowBlur: 0,
        shadowColor: '',
    };
}

let ctx: ReturnType<typeof makeCtx>;

beforeEach(() => {
    ctx = makeCtx();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        ctx as unknown as CanvasRenderingContext2D,
    );
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
        configurable: true,
        value: 200,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
        configurable: true,
        value: 100,
    });
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
        () =>
            ({
                getPropertyValue: (n: string) =>
                    n === '--universe-accent' ? 'rgb(1, 2, 3)' : '',
                color: 'rgb(9, 9, 9)',
            }) as unknown as CSSStyleDeclaration,
    );
    disconnect.mockClear();
    stopWatching.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const star = (edges: [number, number][]) => ({
    points: [
        [0.1, 0.1],
        [0.9, 0.9],
        [0.5, 0.5],
    ] as ([number, number] | null)[],
    edges,
    count: 3,
});

describe('StarMap', () => {
    it('renders an aria-hidden canvas', () => {
        const { container } = render(<StarMap seed={1} star={null} />);

        expect(
            container.querySelector('canvas')?.getAttribute('aria-hidden'),
        ).toBe('true');
    });

    it('does not throw without a 2d context', () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
            null,
        );

        expect(() => render(<StarMap seed={1} star={null} />)).not.toThrow();
    });

    it('draws only non-self-loop edges and one dot per node', () => {
        render(
            <StarMap
                seed={2}
                star={star([
                    [0, 0],
                    [0, 1],
                    [0, 1],
                    [1, 2],
                ])}
            />,
        );

        expect(ctx.moveTo).toHaveBeenCalledTimes(3);
        expect(ctx.arc).toHaveBeenCalledTimes(3);
    });

    it('resolves the CSS var default and passes a literal colour through', () => {
        const { rerender } = render(<StarMap seed={2} star={star([[0, 1]])} />);

        expect(ctx.fills.at(-1)).toBe('rgb(1, 2, 3)');
        expect(ctx.strokes.at(-1)).toBe('rgb(1, 2, 3)');

        const drawsBefore = ctx.arc.mock.calls.length;

        rerender(<StarMap seed={2} star={star([[0, 1]])} color="#ff0000" />);

        expect(ctx.arc.mock.calls.length).toBeGreaterThan(drawsBefore);
        expect(ctx.fills.at(-1)).toBe('#ff0000');
    });

    it('falls back to the canvas colour when the var is unset', () => {
        render(
            <StarMap seed={2} star={star([[0, 1]])} color="var(--missing)" />,
        );

        expect(ctx.fills.at(-1)).toBe('rgb(9, 9, 9)');
    });

    it('redraws on theme change and cleans up on unmount', () => {
        const { unmount } = render(<StarMap seed={2} star={star([[0, 1]])} />);
        const before = ctx.arc.mock.calls.length;

        themeCb();

        expect(ctx.arc.mock.calls.length).toBe(before * 2);

        unmount();

        expect(disconnect).toHaveBeenCalled();
        expect(stopWatching).toHaveBeenCalled();
    });
});
