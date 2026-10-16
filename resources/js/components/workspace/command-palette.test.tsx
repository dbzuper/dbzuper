import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTheme } from '@/hooks/use-appearance';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useRecords } from '@/records/records-store';
import { universe } from '@/universe/controller';
import { useWorkspace } from '@/universe/store';
import { CommandPalette } from './command-palette';

const snap = makeSnapshot(
    [
        { name: 'orders' },
        { name: 'users' },
        { name: 'products' },
        { name: 'order_items' },
    ],
    [
        { from_table: 'orders', to_table: 'users' },
        { from_table: 'order_items', to_table: 'orders' },
        { from_table: 'order_items', to_table: 'products' },
    ],
);

beforeEach(() => {
    useWorkspace.getState().reset();
    useWorkspace.getState().setPaletteOpen(true);
});

describe('CommandPalette', () => {
    it('selects a table and flies to it', () => {
        const fly = vi.spyOn(universe, 'flyTo');
        render(<CommandPalette snapshot={snap} onRefresh={() => {}} />);
        fireEvent.change(
            screen.getByPlaceholderText('Search tables, columns and actions…'),
            { target: { value: 'users' } },
        );
        fireEvent.click(screen.getByRole('option', { name: /users/ }));
        expect(useWorkspace.getState().selected).toBe('users');
        expect(fly).toHaveBeenCalledWith('users');
        expect(useWorkspace.getState().paletteOpen).toBe(false);
    });

    it('completes a pending path when a table is picked', () => {
        useWorkspace.getState().startPath('users');
        render(<CommandPalette snapshot={snap} onRefresh={() => {}} />);
        expect(
            screen.getByText('Find path from users to…'),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('option', { name: /products/ }));
        expect(useWorkspace.getState().path).toEqual([
            'users',
            'orders',
            'order_items',
            'products',
        ]);
    });

    it('cancels a pending path when its start table is picked again', () => {
        useWorkspace.getState().startPath('users');
        render(<CommandPalette snapshot={snap} onRefresh={() => {}} />);
        fireEvent.click(screen.getByRole('option', { name: /users/ }));
        expect(useWorkspace.getState().pathFrom).toBeNull();
        expect(useWorkspace.getState().path).toBeNull();
        expect(useWorkspace.getState().selected).toBeNull();
    });

    it('hides the universe view switch when the universe is unavailable', () => {
        useWorkspace.getState().setView('list');
        render(
            <CommandPalette
                snapshot={snap}
                onRefresh={() => {}}
                universeAvailable={false}
            />,
        );
        expect(
            screen.queryByRole('option', { name: 'Switch to universe view' }),
        ).not.toBeInTheDocument();
        expect(
            screen.getByRole('option', { name: 'Refresh schema' }),
        ).toBeInTheDocument();
    });

    it('offers the universe view switch when the universe is available', () => {
        useWorkspace.getState().setView('list');
        render(<CommandPalette snapshot={snap} onRefresh={() => {}} />);
        fireEvent.click(
            screen.getByRole('option', { name: 'Switch to universe view' }),
        );
        expect(useWorkspace.getState().view).toBe('universe');
    });

    it('runs actions', () => {
        const onRefresh = vi.fn();
        render(<CommandPalette snapshot={snap} onRefresh={onRefresh} />);
        fireEvent.click(screen.getByRole('option', { name: 'Refresh schema' }));
        expect(onRefresh).toHaveBeenCalled();
    });

    it('offers a Records item first for `table key` and opens the record view', () => {
        const open = vi.fn();
        useRecords.setState({ open });
        render(<CommandPalette snapshot={snap} onRefresh={() => {}} />);
        fireEvent.change(
            screen.getByPlaceholderText('Search tables, columns and actions…'),
            { target: { value: 'users 2' } },
        );
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveTextContent('Open record users · 2');
        fireEvent.click(options[0]);
        expect(open).toHaveBeenCalledWith('users', { id: 2 });
        expect(useWorkspace.getState().view).toBe('records');
        expect(useWorkspace.getState().paletteOpen).toBe(false);
    });

    it('shows no Records item for a table that cannot be explored', () => {
        const keyless = makeSnapshot([{ name: 'logs', primary_key: [] }]);
        render(<CommandPalette snapshot={keyless} onRefresh={() => {}} />);
        fireEvent.change(
            screen.getByPlaceholderText('Search tables, columns and actions…'),
            { target: { value: 'logs 2' } },
        );
        expect(screen.queryByText(/Open record/)).toBeNull();
    });
});

describe('CommandPalette theme action', () => {
    it('toggles the theme', () => {
        localStorage.setItem('appearance', 'dark');
        initializeTheme();
        render(<CommandPalette snapshot={snap} onRefresh={() => {}} />);
        fireEvent.click(screen.getByRole('option', { name: /Toggle theme/ }));
        expect(document.documentElement).not.toHaveClass('dark');
        expect(localStorage.getItem('appearance')).toBe('light');
    });
});
