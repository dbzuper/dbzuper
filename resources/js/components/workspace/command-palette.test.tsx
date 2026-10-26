import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowse } from '@/browse/browse-store';
import { initializeTheme } from '@/hooks/use-appearance';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import { useRecords } from '@/records/records-store';
import { universe } from '@/universe/controller';
import { pickPathTarget } from '@/universe/path-pick';
import { useWorkspace } from '@/universe/store';
import { INSPECTOR_HEADING_ID } from '@/components/inspector/inspector-panel';
import { togglePalette } from '@/lib/workspace-shortcuts';
import { CommandPalette } from './command-palette';
import { tableTabOf } from '@/test/browse-tabs';

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
    useBrowse.setState({ byConnection: {} });
    useRecords.setState({ connectionId: '1' });
});

describe('CommandPalette', () => {
    const searchBox = () =>
        screen.getByPlaceholderText('Search tables, columns and actions…');

    it('opens the picked table as a table tab', () => {
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        fireEvent.change(searchBox(), { target: { value: 'orders' } });
        fireEvent.keyDown(searchBox(), { key: 'Enter' });
        expect(useBrowse.getState().get('1').activeId).toBe(
            tableTabOf('1', 'orders')?.id,
        );
        expect(useBrowse.getState().get('1').tabs[1]).toMatchObject({
            table: 'orders',
            preview: false,
        });
        expect(useWorkspace.getState().paletteOpen).toBe(false);
    });

    it('opens a table tab with a draft filter when a column is picked', () => {
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        fireEvent.change(searchBox(), { target: { value: 'id' } });
        fireEvent.click(
            screen.getAllByRole('option', { name: /users\.id/ })[0],
        );
        expect(useBrowse.getState().get('1').activeId).toBe(
            tableTabOf('1', 'users')?.id,
        );
    });

    it('keeps the filters and page of an already-open tab when a column is picked', () => {
        const filters = [{ column: 'id', op: 'eq' as const, value: '7' }];
        useBrowse.getState().openTable('1', 'users', {
            mode: 'permanent',
            state: { filters, view: 'structure' },
        });
        useBrowse
            .getState()
            .updateTable('1', tableTabOf('1', 'users')!.id, { page: 2 });
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        fireEvent.change(searchBox(), { target: { value: 'id' } });
        fireEvent.click(
            screen.getAllByRole('option', { name: /users\.id/ })[0],
        );
        expect(useBrowse.getState().get('1').tabs[1]).toMatchObject({
            state: { filters, page: 2, view: 'data' },
        });
    });

    it('keeps the inspector behaviour on Shift+Enter', () => {
        const fly = vi.spyOn(universe, 'flyTo');
        useBrowse.getState().openTable('1', 'orders');
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        fireEvent.change(searchBox(), { target: { value: 'users' } });
        fireEvent.keyDown(searchBox(), { key: 'Enter', shiftKey: true });
        expect(useWorkspace.getState().selected).toBe('users');
        expect(useBrowse.getState().get('1').activeId).toBe('universe');
        expect(fly).toHaveBeenCalledWith('users');
        expect(useWorkspace.getState().paletteOpen).toBe(false);
    });

    it('lists tables only in quick-open mode', () => {
        useWorkspace.getState().setPaletteOpen(true, 'tables');
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        const input = screen.getByPlaceholderText('Open a table…');
        expect(
            screen.queryByRole('option', { name: 'Refresh schema' }),
        ).not.toBeInTheDocument();
        fireEvent.change(input, { target: { value: 'users 2' } });
        expect(screen.queryByText(/Open record/)).toBeNull();
        fireEvent.change(input, { target: { value: 'users' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(useBrowse.getState().get('1').activeId).toBe(
            tableTabOf('1', 'users')?.id,
        );
        expect(useWorkspace.getState().paletteOpen).toBe(false);
    });

    it('activates the Universe tab before acting on the universe', () => {
        useBrowse.getState().openTable('1', 'orders');
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        fireEvent.click(
            screen.getByRole('option', { name: 'Fit everything on screen' }),
        );
        expect(useBrowse.getState().get('1').activeId).toBe('universe');
    });

    it('moves focus to the inspector heading after a Shift+Enter pick', async () => {
        render(
            <>
                <h2 id={INSPECTOR_HEADING_ID} tabIndex={-1}>
                    users
                </h2>
                <CommandPalette
                    connectionId="1"
                    snapshot={snap}
                    onRefresh={() => {}}
                />
            </>,
        );
        fireEvent.change(searchBox(), { target: { value: 'users' } });
        fireEvent.keyDown(searchBox(), { key: 'Enter', shiftKey: true });

        expect(useWorkspace.getState().selected).not.toBeNull();
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        // After the dialog's own focus restore, which would leave focus on the body.
        await new Promise((r) => setTimeout(r, 10));
        expect(screen.getByRole('heading', { name: 'users' })).toHaveFocus();
    });

    it('returns focus to where the shortcut opened it from when dismissed', async () => {
        useWorkspace.getState().setPaletteOpen(false);
        render(
            <>
                <textarea aria-label="sql" />
                <CommandPalette
                    connectionId="1"
                    snapshot={snap}
                    onRefresh={() => {}}
                />
            </>,
        );
        screen.getByLabelText('sql').focus();
        act(() => togglePalette());
        const input = await screen.findByPlaceholderText(
            'Search tables, columns and actions…',
        );
        fireEvent.keyDown(input, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await new Promise((r) => setTimeout(r, 10));
        expect(screen.getByLabelText('sql')).toHaveFocus();
    });

    it('leaves focus alone when the palette is dismissed', async () => {
        render(
            <>
                <h2 id={INSPECTOR_HEADING_ID} tabIndex={-1}>
                    users
                </h2>
                <CommandPalette
                    connectionId="1"
                    snapshot={snap}
                    onRefresh={() => {}}
                />
            </>,
        );
        fireEvent.keyDown(
            screen.getByPlaceholderText('Search tables, columns and actions…'),
            { key: 'Escape' },
        );
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await new Promise((r) => setTimeout(r, 10));
        expect(
            screen.getByRole('heading', { name: 'users' }),
        ).not.toHaveFocus();
    });

    it('completes a pending path when a table is picked', () => {
        useWorkspace.getState().startPath('users');
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
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
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('option', { name: /users/ }));
        expect(useWorkspace.getState().pathFrom).toBeNull();
        expect(useWorkspace.getState().path).toBeNull();
        expect(useWorkspace.getState().selected).toBeNull();
    });

    it('keeps a pending path start when the palette is dismissed, so the end can be picked elsewhere', () => {
        useWorkspace.getState().startPath('users');
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        fireEvent.keyDown(
            screen.getByPlaceholderText('Search tables, columns and actions…'),
            { key: 'Escape' },
        );
        expect(useWorkspace.getState().paletteOpen).toBe(false);
        expect(useWorkspace.getState().pathFrom).toBe('users');
        // A canvas or card click then completes the path.
        expect(pickPathTarget(snap, 'products')).toBe(true);
        expect(useWorkspace.getState().path).toEqual([
            'users',
            'orders',
            'order_items',
            'products',
        ]);
    });

    it('keeps a completed path (and its start) after picking the end table', () => {
        useWorkspace.getState().startPath('users');
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('option', { name: /products/ }));
        expect(useWorkspace.getState().paletteOpen).toBe(false);
        expect(useWorkspace.getState().pathFrom).toBe('users');
        expect(useWorkspace.getState().path).not.toBeNull();
    });

    it('starting a path from the palette keeps it open to pick the end', () => {
        useWorkspace.getState().select('orders');
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        fireEvent.click(
            screen.getByRole('option', { name: /Find path from orders to/ }),
        );
        expect(useWorkspace.getState().pathFrom).toBe('orders');
        expect(useWorkspace.getState().paletteOpen).toBe(true);
    });

    it('reveals "Make a wish" only for the whole phrase, and makes the wish', () => {
        const wished = vi.fn();
        window.addEventListener('dbzuper:wish', wished);
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        const wish = () =>
            screen.queryByRole('option', { name: 'Make a wish' });

        expect(wish()).not.toBeInTheDocument();
        fireEvent.change(searchBox(), { target: { value: 'make' } });
        expect(wish()).not.toBeInTheDocument();
        fireEvent.change(searchBox(), { target: { value: 'Make a wish' } });
        fireEvent.click(wish()!);

        expect(wished).toHaveBeenCalledOnce();
        expect(useWorkspace.getState().paletteOpen).toBe(false);
        window.removeEventListener('dbzuper:wish', wished);
    });

    it('offers no list or universe view switch', () => {
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        expect(
            screen.queryByRole('option', { name: /Switch to/ }),
        ).not.toBeInTheDocument();
        expect(
            screen.getByRole('option', { name: 'Refresh schema' }),
        ).toBeInTheDocument();
    });

    it('runs actions', () => {
        const onRefresh = vi.fn();
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={onRefresh}
            />,
        );
        fireEvent.click(screen.getByRole('option', { name: 'Refresh schema' }));
        expect(onRefresh).toHaveBeenCalled();
    });

    it('offers a Records item first for `table key` and opens the record view', () => {
        const open = vi.fn();
        useRecords.setState({ open });
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        fireEvent.change(
            screen.getByPlaceholderText('Search tables, columns and actions…'),
            { target: { value: 'users 2' } },
        );
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveTextContent('Open record users · 2');
        fireEvent.click(options[0]);
        expect(open).toHaveBeenCalledWith('users', { id: 2 });
        expect(useBrowse.getState().get('1').activeId).toBe('records');
        expect(useWorkspace.getState().paletteOpen).toBe(false);
    });

    it('shows no Records item for a table that cannot be explored', () => {
        const keyless = makeSnapshot([{ name: 'logs', primary_key: [] }]);
        render(
            <CommandPalette
                connectionId="1"
                snapshot={keyless}
                onRefresh={() => {}}
            />,
        );
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
        render(
            <CommandPalette
                connectionId="1"
                snapshot={snap}
                onRefresh={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('option', { name: /Toggle theme/ }));
        expect(document.documentElement).not.toHaveClass('dark');
        expect(localStorage.getItem('appearance')).toBe('light');
    });
});
