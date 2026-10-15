import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import type { QueryCell, QueryColumn } from '@/types/schema';
import { CellView, ResultGrid } from './result-grid';

const columns: QueryColumn[] = [
    { name: 'id', type: 'int', table: 'orders' },
    { name: 'user_id', type: 'int', table: 'orders' },
    { name: 'note', type: 'text', table: 'orders' },
];
const longText = 'x'.repeat(130);
const rows: QueryCell[][] = [
    [1, 2, null],
    [2, 3, longText],
    [3, null, '{"a":1,"b":[1,2]}'],
];
const snapshot = makeSnapshot(
    [{ name: 'orders' }, { name: 'users' }],
    [{ from_table: 'orders', to_table: 'users', from_columns: ['user_id'] }],
);

describe('CellView', () => {
    it('renders NULL with a data-null marker', () => {
        const { container } = render(
            <CellView value={null} type="text" onOpen={() => {}} />,
        );
        expect(container.querySelector('[data-null="true"]')).toHaveTextContent(
            'NULL',
        );
    });

    it('renders an FK value as a labelled button that fires its callback', () => {
        const onClick = vi.fn();
        render(
            <CellView
                value={2}
                type="int"
                onOpen={() => {}}
                foreign={{ label: 'Open users where id = 2', onClick }}
            />,
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Open users where id = 2' }),
        );
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('offers View for long text and JSON only', () => {
        const onOpen = vi.fn();
        const { rerender } = render(
            <CellView value="short" type="text" onOpen={onOpen} />,
        );
        expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
        rerender(<CellView value={longText} type="text" onOpen={onOpen} />);
        fireEvent.click(screen.getByRole('button', { name: 'View' }));
        expect(onOpen).toHaveBeenCalledOnce();
        rerender(<CellView value='{"a":1}' type="json" onOpen={onOpen} />);
        expect(
            screen.getByRole('button', { name: 'View' }),
        ).toBeInTheDocument();
    });

    it('does not split a surrogate pair at the preview boundary', () => {
        const value = 'a'.repeat(119) + '🚀' + 'b'.repeat(20);
        const { container } = render(
            <CellView value={value} type="text" onOpen={() => {}} />,
        );
        const shown =
            container.querySelector('[data-kind="text"]')!.textContent!;
        expect(shown).toBe('a'.repeat(119) + '🚀');
    });

    it('marks binary and number kinds', () => {
        const { container } = render(
            <>
                <CellView
                    value="[binary 4 bytes]"
                    type="blob"
                    onOpen={() => {}}
                />
                <CellView value={7} type="int" onOpen={() => {}} />
            </>,
        );
        expect(container.querySelector('[data-kind="binary"]')).not.toBeNull();
        expect(container.querySelector('[data-kind="number"]')).not.toBeNull();
    });
});

// jsdom has no layout, so react-data-grid virtualises all but the first column: each test renders one visible column.
const one = (index: number) => ({
    columns: [columns[index]],
    rows: rows.map((r) => [r[index]]),
});

describe('ResultGrid', () => {
    it('renders the header and every body row', () => {
        render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid {...one(0)} />
            </div>,
        );
        expect(
            screen.getByRole('columnheader', { name: 'id' }),
        ).toBeInTheDocument();
        expect(screen.getAllByRole('row')).toHaveLength(4);
    });

    it('sorts client-side when the header is clicked', () => {
        render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid {...one(0)} />
            </div>,
        );
        const order = () =>
            screen.getAllByRole('gridcell').map((c) => c.textContent);
        expect(order()).toEqual(['1', '2', '3']);
        const header = screen.getByRole('columnheader', { name: 'id' });
        fireEvent.click(header);
        fireEvent.click(header);
        expect(order()).toEqual(['3', '2', '1']);
    });

    it('renders NULL cells and links FK cells to the referenced row', () => {
        const onOpenForeign = vi.fn();
        const { container } = render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid
                    {...one(1)}
                    snapshot={snapshot}
                    onOpenForeign={onOpenForeign}
                />
            </div>,
        );
        expect(container.querySelector('[data-null="true"]')).toHaveTextContent(
            'NULL',
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Open users where id = 2' }),
        );
        expect(onOpenForeign).toHaveBeenCalledWith('users', 'id', '2');
        expect(
            screen.queryByRole('button', {
                name: /Open users where id = null/i,
            }),
        ).toBeNull();
    });

    it('opens the cell drawer with the full value, pretty-printing JSON', () => {
        render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid {...one(2)} />
            </div>,
        );
        const views = screen.getAllByRole('button', { name: 'View' });
        expect(views).toHaveLength(2);
        fireEvent.click(views[0]);
        expect(
            screen.getByRole('dialog', { name: 'Cell value' }),
        ).toHaveTextContent(longText);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    });

    it('pretty-prints JSON in the drawer', () => {
        render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid {...one(2)} />
            </div>,
        );
        fireEvent.click(screen.getAllByRole('button', { name: 'View' })[1]);
        const dialog = screen.getByRole('dialog', { name: 'Cell value' });
        expect(dialog.querySelector('pre')?.textContent).toBe(
            JSON.stringify({ a: 1, b: [1, 2] }, null, 2),
        );
    });

    it('opens the parent record for an FK cell that targets the whole PK, else falls back to the filter', () => {
        const onOpenRecord = vi.fn();
        const onOpenForeign = vi.fn();
        const { unmount } = render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid
                    {...one(1)}
                    snapshot={snapshot}
                    onOpenForeign={onOpenForeign}
                    onOpenRecord={onOpenRecord}
                />
            </div>,
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Open users where id = 2' }),
        );
        expect(onOpenRecord).toHaveBeenCalledWith({
            table: 'users',
            key: { id: 2 },
        });
        expect(onOpenForeign).not.toHaveBeenCalled();
        unmount();

        const unique = makeSnapshot(
            [{ name: 'orders' }, { name: 'users' }],
            [
                {
                    from_table: 'orders',
                    to_table: 'users',
                    from_columns: ['user_id'],
                    to_columns: ['email'],
                },
            ],
        );
        render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid
                    {...one(1)}
                    snapshot={unique}
                    onOpenForeign={onOpenForeign}
                    onOpenRecord={onOpenRecord}
                />
            </div>,
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Open users where email = 2' }),
        );
        expect(onOpenRecord).toHaveBeenCalledOnce();
        expect(onOpenForeign).toHaveBeenCalledWith('users', 'email', '2');
    });

    it('adds a leading Open record button per row when the result maps to an explorable table', () => {
        const onOpenRecord = vi.fn();
        render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid
                    {...one(0)}
                    snapshot={snapshot}
                    onOpenRecord={onOpenRecord}
                />
            </div>,
        );
        const buttons = screen.getAllByRole('button', { name: 'Open record' });
        expect(buttons).toHaveLength(3);
        fireEvent.click(buttons[1]);
        expect(onOpenRecord).toHaveBeenCalledWith({
            table: 'orders',
            key: { id: 2 },
        });
    });

    it('offers no row action without a primary key column, a snapshot or a handler', () => {
        const { rerender } = render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid
                    {...one(1)}
                    snapshot={snapshot}
                    onOpenRecord={() => {}}
                />
            </div>,
        );
        expect(
            screen.queryByRole('button', { name: 'Open record' }),
        ).toBeNull();
        rerender(
            <div style={{ blockSize: 400 }}>
                <ResultGrid {...one(0)} snapshot={snapshot} />
            </div>,
        );
        expect(
            screen.queryByRole('button', { name: 'Open record' }),
        ).toBeNull();
    });
});
