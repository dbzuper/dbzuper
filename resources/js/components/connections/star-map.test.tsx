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
        alphas: [] as number[],
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        arc: vi.fn(),
        beginPath: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(
            function (this: { globalAlpha: number; alphas: number[] }) {
                this.alphas.push(this.globalAlpha);
            },
        ),
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

    it('insets layout points from the rounded band corners', () => {
        render(
            <StarMap
                seed={2}
                star={{
                    points: [
                        [0, 0],
                        [1, 1],
                    ],
                    edges: [],
                    count: 2,
                }}
            />,
        );

        // 200×100 canvas, 6px pad: inner 188×88, inset by 10% of each dimension.
        const [[x0, y0], [x1, y1]] = ctx.arc.mock.calls as number[][];

        expect(x0).toBeCloseTo(6 + 18.8);
        expect(y0).toBeCloseTo(6 + 8.8);
        expect(x1).toBeCloseTo(194 - 18.8);
        expect(y1).toBeCloseTo(94 - 8.8);
    });

    it('masks the hero canvas behind the text and keeps its edges short and faint', () => {
        Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
            configurable: true,
            value: 1000,
        });
        Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
            configurable: true,
            value: 220,
        });

        const { container } = render(
            <StarMap seed={21} star={null} density="hero" />,
        );

        expect(container.querySelector('canvas')?.className).toContain(
            'mask-image:linear-gradient(to_right,transparent_25%,black_60%)',
        );
        expect(ctx.moveTo).toHaveBeenCalled();
        expect(ctx.alphas.every((a) => a <= 0.1)).toBe(true);

        ctx.moveTo.mock.calls.forEach(([x1, y1], i) => {
            const [x2, y2] = ctx.lineTo.mock.calls[i] as number[];

            expect(Math.hypot(x2 - x1, y2 - y1)).toBeLessThanOrEqual(250);
        });
    });
});
