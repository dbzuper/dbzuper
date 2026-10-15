import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useWorkspace } from '@/universe/store';
import { PathDialog } from './path-dialog';

const snap = makeSnapshot(
    [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    [{ from_table: 'b', to_table: 'a' }],
);

beforeEach(() => useWorkspace.getState().reset());

describe('PathDialog', () => {
    it('shows the chain and the generated SQL', () => {
        useWorkspace.getState().startPath('a');
        useWorkspace.getState().completePath('b', ['a', 'b']);
        render(<PathDialog snapshot={snap} connectionId={1} />);
        expect(screen.getByRole('dialog')).toHaveTextContent('a → b');
        expect(screen.getByTestId('join-sql')).toHaveTextContent(
            'JOIN "b" AS t1',
        );
    });

    it('explains when no path exists', () => {
        useWorkspace.getState().startPath('a');
        useWorkspace.getState().completePath('c', null);
        render(<PathDialog snapshot={snap} connectionId={1} />);
        expect(
            screen.getByText('No relationship path connects a and c.'),
        ).toBeInTheDocument();
    });

    it('explains hidden inferred relationships instead of emitting SQL', () => {
        useWorkspace.getState().startPath('a');
        useWorkspace.getState().completePath('c', ['a', 'b', 'c']);
        useWorkspace.setState({ showInferred: false });
        render(<PathDialog snapshot={snap} connectionId={1} />);
        expect(
            screen.getByText(/inferred relationships, which are hidden/),
        ).toBeInTheDocument();
        expect(screen.queryByTestId('join-sql')).toBeNull();
    });

    it('handles a same-table path', () => {
        useWorkspace.getState().startPath('a');
        useWorkspace.getState().completePath('a', ['a']);
        render(<PathDialog snapshot={snap} connectionId={1} />);
        expect(
            screen.getByText('Pick a different table to find a path.'),
        ).toBeInTheDocument();
    });

    it('closes via the close button', () => {
        useWorkspace.getState().startPath('a');
        useWorkspace.getState().completePath('b', ['a', 'b']);
        render(<PathDialog snapshot={snap} connectionId={1} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'Close path finder' }),
        );
        expect(useWorkspace.getState().path).toBeNull();
    });
});
