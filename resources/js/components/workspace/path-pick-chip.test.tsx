import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspace } from '@/universe/store';
import { PathPickChip } from './path-pick-chip';

const s = () => useWorkspace.getState();

beforeEach(() => s().reset());

describe('PathPickChip', () => {
    it('is hidden unless a path start is pending', () => {
        const { container } = render(<PathPickChip />);
        expect(container).toBeEmptyDOMElement();
        act(() => {
            s().startPath('users');
            s().completePath('orders', ['users', 'orders']);
        });
        expect(container).toBeEmptyDOMElement();
    });

    it('explains the mode and cancels it', () => {
        s().startPath('users');
        render(<PathPickChip />);
        expect(screen.getByRole('status')).toHaveTextContent(
            'Path from users: click a table or search · Esc to cancel',
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cancel path' }));
        expect(s().pathFrom).toBeNull();
    });

    it('stacks below the focus chip', () => {
        s().startPath('users');
        s().setFocus('users');
        render(<PathPickChip />);
        expect(screen.getByRole('status')).toHaveClass('top-12');
    });
});
