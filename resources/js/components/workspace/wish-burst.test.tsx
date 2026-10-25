import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAWish } from '@/lib/easter-eggs';
import { WishBurst } from './wish-burst';

const toast = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast }));

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock('@/universe/motion', () => ({
    prefersReducedMotion: () => reduced.value,
}));

beforeEach(() => {
    toast.mockReset();
    reduced.value = false;
});

describe('WishBurst', () => {
    it('draws nothing until a wish is made', () => {
        render(<WishBurst />);

        expect(screen.queryByTestId('wish-burst')).toBeNull();
    });

    it('bursts with seven orbs and grants the wish', () => {
        const { container } = render(<WishBurst />);

        act(() => makeAWish());

        expect(screen.getByTestId('wish-burst')).toHaveAttribute('aria-hidden');
        expect(container.querySelectorAll('.wish-orb')).toHaveLength(7);
        expect(toast).toHaveBeenCalledWith(
            'Wish granted. Every table is present and accounted for.',
        );
    });

    it('only grants the wish with reduced motion', () => {
        reduced.value = true;
        render(<WishBurst />);

        act(() => makeAWish());

        expect(screen.queryByTestId('wish-burst')).toBeNull();
        expect(toast).toHaveBeenCalledOnce();
    });
});
