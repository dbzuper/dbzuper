import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StarMap } from '@/components/connections/star-map';

describe('StarMap', () => {
    it('renders an aria-hidden canvas without throwing when there is no 2d context', () => {
        const { container } = render(<StarMap seed={1} star={null} />);

        expect(
            container.querySelector('canvas')?.getAttribute('aria-hidden'),
        ).toBe('true');
    });

    it('tolerates self-loop and duplicate edges', () => {
        const star = {
            points: [[0.1, 0.1], null] as ([number, number] | null)[],
            edges: [
                [0, 0],
                [0, 1],
                [0, 1],
            ] as [number, number][],
            count: 2,
        };

        expect(() =>
            render(<StarMap seed={2} star={star} density="hero" />),
        ).not.toThrow();
    });
});
