import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushBrowse, useBrowse } from '@/browse/browse-store';
import { dispatchBrowseKey } from '@/browse/key-dispatch';
import { refOf, usePending } from '@/editing/pending-store';
import { useReview } from '@/editing/review-store';
import { makeSnapshot } from '@/universe/__fixtures__/snapshot';
import type { QueryCell, QueryColumn } from '@/types/schema';
import { CellView, ResultGrid, type GridEditing } from './result-grid';

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
        expect(
            screen.queryByRole('button', { name: 'Open users where id = 2' }),
        ).toBeNull();
        fireEvent.click(
            screen.getByRole('button', { name: 'Open record users 2' }),
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
        expect(buttons[0]).toHaveClass(
            'focus-visible:ring-2',
            'focus-visible:ring-[var(--universe-accent)]',
        );
        fireEvent.click(buttons[1]);
        expect(onOpenRecord).toHaveBeenCalledWith({
            table: 'orders',
            key: { id: 2 },
        });
    });

    it('decides Open record per row: none on a NULL-PK row, present on rows that resolve even when row 0 does not', () => {
        const onOpenRecord = vi.fn();
        const pkRows: QueryCell[][] = [
            [null, 2],
            [2, 3],
            [3, null],
        ];
        render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid
                    columns={columns.slice(0, 2)}
                    rows={pkRows}
                    snapshot={snapshot}
                    onOpenRecord={onOpenRecord}
                />
            </div>,
        );
        const buttons = screen.getAllByRole('button', { name: 'Open record' });
        expect(buttons).toHaveLength(2);
        fireEvent.click(buttons[0]);
        expect(onOpenRecord).toHaveBeenCalledWith({
            table: 'orders',
            key: { id: 2 },
        });
    });

    it('offers no Open record button when no row resolves', () => {
        render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid
                    columns={columns.slice(0, 2)}
                    rows={[
                        [null, 1],
                        [null, 2],
                    ]}
                    snapshot={snapshot}
                    onOpenRecord={() => {}}
                />
            </div>,
        );
        expect(
            screen.queryByRole('button', { name: 'Open record' }),
        ).toBeNull();
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

describe('CellView object values', () => {
    it('shows an object cell as JSON, not [object Object]', () => {
        const { container } = render(
            <CellView
                value={{ a: 1, b: [2] }}
                type="jsonb"
                onOpen={() => {}}
            />,
        );
        expect(container).toHaveTextContent('{"a":1,"b":[2]}');
        expect(container).not.toHaveTextContent('[object Object]');
        expect(
            screen.getByRole('button', { name: 'View' }),
        ).toBeInTheDocument();
    });
});

describe('table tab features', () => {
    const tabColumns: QueryColumn[] = [
        { name: 'id', type: 'integer', table: 'users' },
        { name: 'name', type: 'text', table: 'users' },
        { name: 'secret', type: 'text', table: 'users' },
    ];
    const data: QueryCell[][] = [
        [1, 'Ada', 'x'],
        [2, 'Grace', 'y'],
    ];
    const wrap = (node: React.ReactNode) => (
        <div style={{ blockSize: 400 }}>{node}</div>
    );
    const idOnly = {
        columns: tabColumns.slice(0, 1),
        rows: data.map((r) => [r[0]]),
    };

    it('hides columns and reports filter clicks without sorting', () => {
        const onFilterColumn = vi.fn();
        const onSort = vi.fn();
        render(
            wrap(
                <ResultGrid
                    columns={tabColumns}
                    rows={data}
                    layout={{
                        value: { widths: {}, hidden: ['id'] },
                        onChange: vi.fn(),
                    }}
                    onFilterColumn={onFilterColumn}
                    sort={{ columns: [], onChange: onSort, maxKeys: 3 }}
                />,
            ),
        );
        expect(
            screen.queryByRole('columnheader', { name: /id/ }),
        ).not.toBeInTheDocument();
        expect(
            screen.getByRole('columnheader', { name: /name/ }),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Filter name' }));
        expect(onFilterColumn).toHaveBeenCalledWith('name');
        expect(onSort).not.toHaveBeenCalled();
    });

    it('filters, not sorts, when the header filter button is activated by keyboard', () => {
        const onFilterColumn = vi.fn();
        const onSort = vi.fn();
        render(
            wrap(
                <ResultGrid
                    {...idOnly}
                    onFilterColumn={onFilterColumn}
                    sort={{ columns: [], onChange: onSort }}
                />,
            ),
        );
        fireEvent.keyDown(screen.getByRole('button', { name: 'Filter id' }), {
            key: 'Enter',
        });
        expect(onFilterColumn).toHaveBeenCalledWith('id');
        expect(onSort).not.toHaveBeenCalled();
    });

    it('offers no row menu when the context click is on the header', () => {
        render(
            wrap(
                <ResultGrid
                    {...idOnly}
                    rowMenu={{ dialect: 'pgsql', table: 'users' }}
                />,
            ),
        );
        fireEvent.contextMenu(screen.getByRole('gridcell', { name: '2' }));
        fireEvent.keyDown(document.body, { key: 'Escape' });
        fireEvent.contextMenu(screen.getByRole('columnheader', { name: /id/ }));
        expect(screen.queryByRole('menuitem')).toBeNull();
    });

    it('toggles: the open row’s button closes it, another row’s button opens that row', () => {
        const onOpenRow = vi.fn();
        const onCloseRow = vi.fn();
        render(
            wrap(
                <ResultGrid
                    columns={tabColumns}
                    rows={data}
                    onOpenRow={onOpenRow}
                    onCloseRow={onCloseRow}
                    activeRow={1}
                />,
            ),
        );
        const [first, open] = screen.getAllByRole('button', {
            name: 'Open row',
        });
        expect(open).toHaveAttribute('aria-expanded', 'true');
        expect(open).toHaveAttribute('title', 'Close row');
        expect(first).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(open);
        expect(onCloseRow).toHaveBeenCalledTimes(1);
        expect(onOpenRow).not.toHaveBeenCalled();
        fireEvent.click(first);
        expect(onOpenRow).toHaveBeenCalledWith(0);
    });

    it('opens rows from the row button and highlights the active row', () => {
        const onOpenRow = vi.fn();
        render(
            wrap(
                <ResultGrid
                    columns={tabColumns}
                    rows={data}
                    onOpenRow={onOpenRow}
                    activeRow={1}
                />,
            ),
        );
        expect(
            screen.getAllByRole('button', { name: 'Open row' })[1],
        ).toHaveAttribute('data-row-index', '1');
        fireEvent.click(screen.getAllByRole('button', { name: 'Open row' })[1]);
        expect(onOpenRow).toHaveBeenCalledWith(1);
        expect(
            screen
                .getAllByRole('row')
                .some((r) => r.classList.contains('rdg-row-active')),
        ).toBe(true);
    });

    it('keeps up to maxKeys sort keys', () => {
        const onChange = vi.fn();
        render(
            wrap(
                <ResultGrid
                    {...idOnly}
                    sort={{
                        columns: [{ columnKey: '5', direction: 'ASC' }],
                        onChange,
                        maxKeys: 3,
                    }}
                />,
            ),
        );
        fireEvent.click(screen.getByRole('columnheader', { name: /id/ }), {
            ctrlKey: true,
        });
        expect(onChange.mock.calls[0][0]).toHaveLength(2);
    });

    it('trims the oldest sort key beyond maxKeys and defaults to one key', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            wrap(
                <ResultGrid
                    {...idOnly}
                    sort={{
                        columns: [
                            { columnKey: '5', direction: 'ASC' },
                            { columnKey: '6', direction: 'ASC' },
                        ],
                        onChange,
                        maxKeys: 2,
                    }}
                />,
            ),
        );
        fireEvent.click(screen.getByRole('columnheader', { name: /id/ }), {
            ctrlKey: true,
        });
        expect(onChange.mock.calls[0][0]).toHaveLength(2);
        rerender(
            wrap(<ResultGrid {...idOnly} sort={{ columns: [], onChange }} />),
        );
        fireEvent.click(screen.getByRole('columnheader', { name: /id/ }));
        expect(onChange.mock.calls[1][0]).toHaveLength(1);
    });

    it('copies selected rows as INSERT from the row menu', async () => {
        const write = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText: write } });
        render(
            wrap(
                <ResultGrid
                    columns={tabColumns}
                    rows={data}
                    rowMenu={{ dialect: 'pgsql', table: 'users' }}
                />,
            ),
        );
        fireEvent.contextMenu(screen.getByRole('gridcell', { name: '2' }));
        fireEvent.click(
            await screen.findByRole('menuitem', { name: 'Copy as INSERT' }),
        );
        await vi.waitFor(() =>
            expect(write).toHaveBeenCalledWith(
                expect.stringContaining("(2, 'Grace', 'y');"),
            ),
        );
    });

    describe('selection bar', () => {
        const renderSelectable = () =>
            render(
                wrap(
                    <ResultGrid
                        columns={tabColumns}
                        rows={data}
                        rowMenu={{ dialect: 'pgsql', table: 'users' }}
                    />,
                ),
            );
        const toolbar = () =>
            screen.queryByRole('toolbar', { name: 'Selected rows' });
        const selectAll = () =>
            screen
                .getAllByRole('checkbox', { name: 'Select' })
                .forEach((box) => fireEvent.click(box));

        it('is hidden with no selection and counts the selected rows', () => {
            const { container } = renderSelectable();
            expect(toolbar()).toBeNull();
            // The live region is there before the first selection, so the first one is announced too.
            const live = () =>
                container.querySelectorAll('[aria-live="polite"]');
            expect(live()).toHaveLength(1);
            const region = live()[0];
            expect(region).toHaveTextContent('');
            fireEvent.click(
                screen.getAllByRole('checkbox', { name: 'Select' })[0],
            );
            expect(toolbar()).toHaveTextContent('1 selected');
            expect(live()).toHaveLength(1);
            expect(live()[0]).toBe(region);
            expect(region).toHaveTextContent('1 selected');
            fireEvent.click(
                screen.getAllByRole('checkbox', { name: 'Select' })[1],
            );
            expect(within(toolbar()!).getByText('2 selected')).toBeVisible();
            expect(region).toHaveTextContent('2 selected');
        });

        it('is never shown without row checkboxes', () => {
            render(wrap(<ResultGrid columns={tabColumns} rows={data} />));
            expect(screen.queryByRole('checkbox')).toBeNull();
            expect(toolbar()).toBeNull();
        });

        it('copies as JSON exactly what the row menu copies', async () => {
            const write = vi.fn().mockResolvedValue(undefined);
            Object.assign(navigator, { clipboard: { writeText: write } });
            renderSelectable();
            selectAll();
            fireEvent.contextMenu(screen.getByRole('gridcell', { name: '2' }));
            fireEvent.click(
                await screen.findByRole('menuitem', { name: 'Copy as JSON' }),
            );
            await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
            const fromMenu = write.mock.calls[0][0];
            expect(fromMenu).toContain('Grace');
            fireEvent.keyDown(document.body, { key: 'Escape' });
            await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

            fireEvent.keyDown(
                within(toolbar()!).getByRole('button', { name: /Copy as/ }),
                { key: 'Enter' },
            );
            fireEvent.click(
                await screen.findByRole('menuitem', { name: 'JSON' }),
            );
            await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
            expect(write.mock.calls[1][0]).toBe(fromMenu);
            const menuItems = () =>
                screen.queryAllByRole('menuitem').map((i) => i.textContent);
            fireEvent.keyDown(
                within(toolbar()!).getByRole('button', { name: /Copy as/ }),
                { key: 'Enter' },
            );
            await waitFor(() =>
                expect(menuItems()).toEqual(['JSON', 'INSERT', 'CSV']),
            );
        });

        it('clears the selection with Clear, and offers no Delete without editing', () => {
            renderSelectable();
            selectAll();
            expect(
                within(toolbar()!).queryByRole('button', { name: /^Delete/ }),
            ).toBeNull();
            fireEvent.click(
                within(toolbar()!).getByRole('button', { name: 'Clear' }),
            );
            expect(toolbar()).toBeNull();
            for (const box of screen.getAllByRole('checkbox', {
                name: 'Select',
            }))
                expect(box).not.toBeChecked();
        });

        it('clears the selection with Escape in the grid', () => {
            renderSelectable();
            selectAll();
            const cell = screen.getByRole('gridcell', { name: '2' });
            fireEvent.mouseDown(cell);
            expect(toolbar()).not.toBeNull();
            fireEvent.keyDown(cell, { key: 'Escape' });
            expect(toolbar()).toBeNull();
        });
    });

    it('calls onOpenRow on Enter', () => {
        const onOpenRow = vi.fn();
        render(
            wrap(
                <ResultGrid
                    columns={tabColumns}
                    rows={data}
                    onOpenRow={onOpenRow}
                />,
            ),
        );
        const cell = screen.getByRole('gridcell', { name: '2' });
        fireEvent.mouseDown(cell);
        fireEvent.click(cell);
        fireEvent.keyDown(cell, { key: 'Enter' });
        expect(onOpenRow).toHaveBeenCalledWith(1);
    });
});

describe('cell display', () => {
    it('marks an empty string distinctly from NULL', () => {
        const { container } = render(
            <CellView value="" type="text" onOpen={() => {}} />,
        );
        const el = container.querySelector('[data-empty="true"]');
        expect(el).not.toBeNull();
        expect(el).toHaveClass('bg-muted/40');
        expect(container.querySelector('[data-null="true"]')).toBeNull();
    });

    it('renders booleans as check and cross marks', () => {
        render(
            <>
                <CellView value={true} type="bool" onOpen={() => {}} />
                <CellView value={false} type="bool" onOpen={() => {}} />
            </>,
        );
        expect(screen.getByLabelText('true')).toHaveTextContent('✓');
        expect(screen.getByLabelText('false')).toHaveTextContent('✗');
    });

    it('renders the binary placeholder as a blob size', () => {
        render(
            <CellView
                value="[binary 12288 bytes]"
                type="blob"
                onOpen={() => {}}
            />,
        );
        expect(screen.getByText('‹blob 12 KB›')).toBeInTheDocument();
    });

    it('gives truncated text a title with its first 500 characters', () => {
        const long = 'y'.repeat(700);
        const { container } = render(
            <CellView value={long} type="text" onOpen={() => {}} />,
        );
        expect(container.querySelector('[title]')).toHaveAttribute(
            'title',
            'y'.repeat(500),
        );
    });
});

describe('cell titles', () => {
    it('titles short text cells too', () => {
        const { container } = render(
            <CellView value="hello" type="text" onOpen={() => {}} />,
        );
        expect(container.querySelector('[title]')).toHaveAttribute(
            'title',
            'hello',
        );
    });
});

describe('editing', () => {
    const editColumns: QueryColumn[] = [
        { name: 'name', type: 'text', table: 'users' },
        { name: 'id', type: 'integer', table: 'users' },
    ];
    const tableColumns = [
        {
            name: 'name',
            type: 'text',
            type_name: 'text',
            nullable: false,
            default: null,
            auto_increment: false,
            comment: null,
        },
        {
            name: 'id',
            type: 'integer',
            type_name: 'integer',
            nullable: false,
            default: null,
            auto_increment: true,
            comment: null,
        },
    ];
    const editRows: QueryCell[][] = [
        ['Ada', 1],
        ['Grace', 2],
        ['Linus', 3],
    ];
    const editing = (over: Partial<GridEditing> = {}): GridEditing => ({
        connectionId: 1,
        table: 'users',
        dialect: 'pgsql',
        rowIds: [{ key: { id: 1 } }, { key: { id: 2 } }, null],
        locked: [[], [0], []],
        shortened: [[], [0], []],
        readOnlyColumns: [],
        rowReason: null,
        tableColumns,
        ...over,
    });
    const pending = () => usePending.getState().byTable['1:users'] ?? {};
    const ref1 = refOf({ key: { id: 1 } });
    const renderGrid = (
        props: Partial<Parameters<typeof ResultGrid>[0]> = {},
    ) =>
        render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid
                    columns={editColumns}
                    rows={editRows}
                    rowMenu={{ dialect: 'pgsql', table: 'users' }}
                    editing={editing()}
                    {...props}
                />
            </div>,
        );
    const cell = (text: string | RegExp) =>
        screen.getByRole('gridcell', { name: text });
    const edit = (text: string | RegExp) => {
        fireEvent.doubleClick(cell(text));
        return screen.getByRole('textbox');
    };

    beforeEach(() => usePending.setState({ byTable: {}, errors: {} }));

    it('stages an edit on Enter and shows it as edited with the original in its tooltip', () => {
        renderGrid();
        const input = edit('Ada');
        expect(input).toHaveValue('Ada');
        fireEvent.change(input, { target: { value: 'Ada L.' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(pending()[ref1]).toMatchObject({
            kind: 'update',
            original: { name: 'Ada', id: 1 },
            values: { name: 'Ada L.' },
        });
        const edited = cell(/Ada L\./);
        expect(edited).toHaveClass('rdg-cell-edited');
        expect(edited).toHaveTextContent('edited');
        expect(edited.querySelector('[data-edited]')).toHaveAttribute(
            'title',
            'Original: Ada',
        );
    });

    it('stages the open editor’s draft before Ctrl+S opens Review, so the preview includes it', () => {
        flushBrowse();
        useBrowse.setState({ byConnection: {} });
        useBrowse.getState().openTable(1, 'users', { mode: 'permanent' });
        useReview.setState({ open: null, nonce: 0 });
        renderGrid();
        const input = edit('Ada');
        fireEvent.change(input, { target: { value: 'Ada L.' } });
        // Nothing staged yet: the draft lives in the editor.
        expect(pending()).toEqual({});
        const e = new KeyboardEvent('keydown', {
            key: 's',
            ctrlKey: true,
            cancelable: true,
        });
        act(() => {
            dispatchBrowseKey(e, 1, true);
        });
        expect(pending()[ref1]).toMatchObject({ values: { name: 'Ada L.' } });
        expect(useReview.getState().open).toEqual({
            connectionId: 1,
            table: 'users',
        });
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('opens the editor from the keyboard with Enter and F2', () => {
        renderGrid();
        fireEvent.mouseDown(cell('Ada'));
        fireEvent.keyDown(cell('Ada'), { key: 'Enter' });
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
        expect(screen.queryByRole('textbox')).toBeNull();
        fireEvent.keyDown(cell('Ada'), { key: 'F2' });
        expect(screen.getByRole('textbox')).toHaveValue('Ada');
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
        // Typing a character doesn't open an editor that would drop it.
        fireEvent.keyDown(cell('Ada'), { key: 'x' });
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('cancels on Escape', () => {
        renderGrid();
        const input = edit('Ada');
        fireEvent.change(input, { target: { value: 'nope' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(pending()).toEqual({});
        expect(cell('Ada')).toBeInTheDocument();
    });

    it('keeps the value on Tab and moves to the next cell', () => {
        renderGrid();
        const input = edit('Ada');
        fireEvent.change(input, { target: { value: 'Ada L.' } });
        fireEvent.keyDown(input, { key: 'Tab' });
        expect(pending()[ref1]).toMatchObject({ values: { name: 'Ada L.' } });
        expect(screen.queryByRole('textbox')).toBeNull();
        const active = screen
            .getAllByRole('gridcell')
            .find((c) => c.getAttribute('aria-selected') === 'true');
        expect(active).toHaveTextContent('1');
    });

    it("doesn't edit a locked cell or a row that can't be pinned, and says why", () => {
        renderGrid();
        fireEvent.doubleClick(cell(/^Grace/));
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(cell(/^Grace/).querySelector('[data-locked]')).toHaveAttribute(
            'title',
            'Not editable: shortened for display',
        );
        fireEvent.doubleClick(cell(/^Linus/));
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(
            cell(/^Linus/)
                .querySelector('[data-locked]')
                ?.getAttribute('title'),
        ).toMatch(/^Not editable: this row can't be pinned/);
    });

    it('names generated and binary columns as the reason', () => {
        renderGrid({
            columns: [{ name: 'total', type: 'bytea', table: 'users' }],
            rows: [[5], ['[binary 3 bytes]']],
            editing: editing({
                tableColumns: [],
                rowIds: [{ key: { id: 1 } }, { key: { id: 2 } }],
                locked: [[0], [0]],
                shortened: [[], [0]],
                readOnlyColumns: [],
            }),
        });
        expect(cell(/^5/).querySelector('[data-locked]')).toHaveAttribute(
            'title',
            'Not editable: binary',
        );
        cleanup();
        renderGrid({
            columns: [{ name: 'total', type: 'integer', table: 'users' }],
            rows: [[5]],
            editing: editing({
                tableColumns: [],
                rowIds: [{ key: { id: 1 } }],
                locked: [[0]],
                shortened: [[]],
                readOnlyColumns: ['total'],
            }),
        });
        expect(cell(/^5/).querySelector('[data-locked]')).toHaveAttribute(
            'title',
            'Not editable: generated column',
        );
    });

    it('is not editable without editing (method none, read-only connection, SQL results)', () => {
        renderGrid({ editing: undefined });
        fireEvent.doubleClick(cell('Ada'));
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(cell('Ada')).toHaveAttribute('aria-readonly', 'true');
    });

    it('sets NULL and reverts a change from the cell menu', async () => {
        renderGrid();
        fireEvent.contextMenu(cell('Ada'));
        fireEvent.click(
            await screen.findByRole('menuitem', { name: 'Set NULL' }),
        );
        expect(pending()[ref1]).toMatchObject({ values: { name: null } });
        fireEvent.keyDown(document.body, { key: 'Escape' });
        fireEvent.contextMenu(cell(/NULL/));
        fireEvent.click(
            await screen.findByRole('menuitem', { name: 'Revert change' }),
        );
        expect(pending()).toEqual({});
    });

    it('marks the selected rows for deletion with the Delete key, and restores them', async () => {
        renderGrid();
        fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select' })[0]);
        fireEvent.mouseDown(cell(/^Grace/));
        fireEvent.keyDown(cell(/^Grace/), { key: 'Delete' });
        expect(screen.queryByRole('textbox')).toBeNull();
        // The selected row, not the active one.
        expect(Object.keys(pending())).toEqual([ref1]);
        expect(pending()[ref1]).toMatchObject({ kind: 'delete' });
        const row = cell(/Ada/).closest('[role="row"]')!;
        expect(row).toHaveClass('rdg-row-deleted');
        expect(row).toHaveTextContent('deleted');
        // A row marked for deletion isn't edited.
        fireEvent.doubleClick(cell(/Ada/));
        expect(screen.queryByRole('textbox')).toBeNull();
        fireEvent.contextMenu(cell(/Ada/));
        fireEvent.click(
            await screen.findByRole('menuitem', { name: 'Restore row' }),
        );
        expect(pending()).toEqual({});
    });

    it('marks two of three identical key-less rows as two deletions', () => {
        const dup = { values: { name: 'Same', id: 7 } };
        renderGrid({
            rows: [
                ['Same', 7],
                ['Same', 7],
                ['Same', 7],
            ],
            editing: editing({
                dialect: 'mysql',
                rowIds: [dup, dup, dup],
                locked: [[], [], []],
                shortened: [[], [], []],
            }),
        });
        const boxes = screen.getAllByRole('checkbox', { name: 'Select' });
        fireEvent.click(boxes[0]);
        fireEvent.click(boxes[2]);
        const first = screen.getAllByRole('gridcell', { name: /^Same/ })[0];
        fireEvent.mouseDown(first);
        fireEvent.keyDown(first, { key: 'Delete' });
        expect(usePending.getState().count(1, 'users')).toEqual({
            inserted: 0,
            updated: 0,
            deleted: 2,
        });
        const rowsShown = screen
            .getAllByRole('gridcell', { name: /^Same/ })
            .map((c) => c.closest('[role="row"]')!);
        expect(
            rowsShown.map((r) => r.classList.contains('rdg-row-deleted')),
        ).toEqual([true, false, true]);
    });

    it('outlines a row whose change failed to commit, with the error in its tooltip, until it is edited', () => {
        renderGrid();
        act(() => {
            usePending.getState().markDelete(1, 'users', {
                ref: ref1,
                id: { key: { id: 1 } },
                original: {},
            });
            usePending.getState().setErrors(1, 'users', {
                [ref1]: 'row changed since you loaded it',
            });
        });
        const row = cell(/Ada/).closest('[role="row"]')!;
        expect(row).toHaveClass('rdg-row-error');
        expect(
            row.querySelector('[title*="row changed since you loaded it"]'),
        ).not.toBeNull();
        expect(row).toHaveTextContent('row changed since you loaded it');
        act(() => usePending.getState().unmarkDelete(1, 'users', ref1));
        expect(cell(/Ada/).closest('[role="row"]')).not.toHaveClass(
            'rdg-row-error',
        );
    });

    it('marks the active row with Delete when nothing is selected', () => {
        renderGrid();
        fireEvent.mouseDown(cell('Ada'));
        fireEvent.keyDown(cell('Ada'), { key: 'Delete' });
        expect(pending()[ref1]).toMatchObject({ kind: 'delete' });
    });

    it('stages the selected rows for deletion from the selection bar, then restores them', () => {
        renderGrid();
        const boxes = () => screen.getAllByRole('checkbox', { name: 'Select' });
        fireEvent.click(boxes()[0]);
        fireEvent.click(boxes()[1]);
        const toolbar = () =>
            screen.queryByRole('toolbar', { name: 'Selected rows' });
        fireEvent.click(
            within(toolbar()!).getByRole('button', { name: 'Delete 2 rows' }),
        );
        expect(usePending.getState().count(1, 'users')).toEqual({
            inserted: 0,
            updated: 0,
            deleted: 2,
        });
        expect(toolbar()).toBeNull();
        expect(boxes()[0]).not.toBeChecked();

        // Every selected row already marked: the bar restores instead.
        fireEvent.click(boxes()[0]);
        expect(
            within(toolbar()!).queryByRole('button', { name: /^Delete/ }),
        ).toBeNull();
        fireEvent.click(
            within(toolbar()!).getByRole('button', { name: 'Restore 1 row' }),
        );
        expect(usePending.getState().count(1, 'users').deleted).toBe(1);
        expect(toolbar()).toBeNull();
        // A mix of marked and unmarked rows still offers Delete.
        fireEvent.click(boxes()[0]);
        fireEvent.click(boxes()[1]);
        expect(
            within(toolbar()!).getByRole('button', { name: 'Delete 2 rows' }),
        ).toBeInTheDocument();
    });

    it('counts only the rows it can stage, the same in the row menu and the bar', async () => {
        renderGrid();
        // Linus (the third row) has no row identity: nothing to stage.
        for (const box of screen.getAllByRole('checkbox', { name: 'Select' }))
            fireEvent.click(box);
        const bar = screen.getByRole('toolbar', { name: 'Selected rows' });
        expect(within(bar).getByText('3 selected')).toBeInTheDocument();
        expect(
            within(bar).getByRole('button', { name: 'Delete 2 rows' }),
        ).toBeInTheDocument();
        fireEvent.contextMenu(cell('Ada'));
        expect(
            await screen.findByRole('menuitem', { name: 'Delete 2 rows' }),
        ).toBeInTheDocument();
    });

    it('keeps the selection when Escape cancels a cell edit', () => {
        renderGrid();
        const boxes = () => screen.getAllByRole('checkbox', { name: 'Select' });
        fireEvent.click(boxes()[1]);
        const input = edit('Ada');
        fireEvent.change(input, { target: { value: 'nope' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(pending()).toEqual({});
        expect(boxes()[1]).toBeChecked();
        expect(
            within(
                screen.getByRole('toolbar', { name: 'Selected rows' }),
            ).getByText('1 selected'),
        ).toBeInTheDocument();
    });

    it('offers no Delete in the selection bar without editing', () => {
        renderGrid({ editing: undefined });
        fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select' })[0]);
        const bar = screen.getByRole('toolbar', { name: 'Selected rows' });
        expect(within(bar).getByText('1 selected')).toBeInTheDocument();
        expect(
            within(bar).queryByRole('button', { name: /^Delete/ }),
        ).toBeNull();
        expect(
            within(bar).queryByRole('button', { name: /^Restore/ }),
        ).toBeNull();
    });

    it('deletes a row from the row menu', async () => {
        renderGrid();
        fireEvent.contextMenu(cell('Ada'));
        fireEvent.click(
            await screen.findByRole('menuitem', { name: 'Delete row' }),
        );
        expect(pending()[ref1]).toMatchObject({ kind: 'delete' });
    });

    it('puts the pending mark in the row button cell instead of its own column', () => {
        renderGrid({ onOpenRow: vi.fn() });
        const columnsBefore = screen.getAllByRole('columnheader').length;
        act(() =>
            usePending.getState().markDelete(1, 'users', {
                ref: ref1,
                id: { key: { id: 1 } },
                original: {},
            }),
        );
        const openButton = within(
            cell(/Ada/).closest('[role="row"]')!,
        ).getByRole('button', { name: 'Open row' });
        expect(openButton.closest('[role="gridcell"]')).toHaveTextContent(
            'deleted',
        );
        expect(screen.getAllByRole('columnheader')).toHaveLength(columnsBefore);
        expect(
            screen.queryByRole('columnheader', { name: 'Pending change' }),
        ).toBeNull();
    });

    it('shows new rows at the top with default placeholders and flags required columns', () => {
        const ref = usePending.getState().addRow(1, 'users');
        renderGrid();
        const first = screen.getAllByRole('row')[1];
        expect(first).toHaveClass('rdg-row-new');
        expect(first).toHaveTextContent('new row');
        // `name` is NOT NULL without a default.
        expect(first).toHaveTextContent('required');
        const input = edit(/required/);
        expect(input).toHaveValue('');
        fireEvent.change(input, { target: { value: 'New' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(pending()[ref]).toEqual({
            kind: 'insert',
            ref,
            values: { name: 'New' },
        });
    });

    it('edits booleans with a checkbox, stored as the engine writes them', () => {
        renderGrid({
            columns: [{ name: 'active', type: 'boolean', table: 'users' }],
            rows: [[true], [false]],
            editing: editing({
                dialect: 'mysql',
                tableColumns: [],
                rowIds: [{ key: { id: 1 } }, { key: { id: 2 } }],
                locked: [[], []],
                shortened: [[], []],
            }),
        });
        fireEvent.doubleClick(
            screen.getAllByRole('gridcell', { name: /true/ })[0],
        );
        const box = screen.getByRole('checkbox', { name: 'active' });
        expect(box).toBeChecked();
        fireEvent.click(box);
        fireEvent.keyDown(box, { key: 'Enter' });
        expect(pending()[ref1]).toMatchObject({ values: { active: '0' } });
    });

    it('validates JSON before staging it', () => {
        renderGrid({
            columns: [{ name: 'meta', type: 'jsonb', table: 'users' }],
            rows: [['{"a":1}'], ['{}']],
            editing: editing({
                tableColumns: [],
                rowIds: [{ key: { id: 1 } }, { key: { id: 2 } }],
                locked: [[], []],
                shortened: [[], []],
            }),
        });
        const input = edit(/"a":1/);
        fireEvent.change(input, { target: { value: '{"a":' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(screen.getByRole('textbox')).toHaveAttribute(
            'aria-invalid',
            'true',
        );
        expect(screen.getByRole('alert')).toHaveTextContent(/Invalid JSON/);
        expect(pending()).toEqual({});
        fireEvent.change(screen.getByRole('textbox'), {
            target: { value: '{"a":2}' },
        });
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
        expect(pending()[ref1]).toMatchObject({ values: { meta: '{"a":2}' } });
    });

    it('announces why a cell is locked, not only in its tooltip', () => {
        renderGrid();
        expect(cell(/^Grace/)).toHaveAccessibleName(
            /Not editable: shortened for display/,
        );
    });

    it('never edits a multi-line value inline (an input would join its lines)', () => {
        renderGrid({
            rows: [
                ['line1\nline2', 1],
                ['b\r\nc', 2],
            ],
        });
        const multi = screen.getAllByRole('gridcell', { name: /line1/ })[0];
        fireEvent.doubleClick(multi);
        expect(screen.queryByRole('textbox')).toBeNull();
        fireEvent.mouseDown(multi);
        fireEvent.keyDown(multi, { key: 'Enter' });
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(multi.querySelector('[data-locked]')).toHaveAttribute(
            'title',
            'Multi-line value: edit it in the row drawer',
        );
        expect(pending()).toEqual({});
    });

    it('keeps a selected new row selected when an older new row goes', async () => {
        const store = usePending.getState();
        const a = store.addRow(1, 'users');
        const b = store.addRow(1, 'users');
        const c = store.addRow(1, 'users');
        renderGrid();
        // Newest first: c, b, a.
        const boxes = () => screen.getAllByRole('checkbox', { name: 'Select' });
        fireEvent.click(boxes()[1]);
        const rowOf = (i: number) => screen.getAllByRole('row')[i + 1];
        // Remove a (the oldest, third row) from its menu.
        fireEvent.contextMenu(
            within(rowOf(2)).getAllByRole('gridcell').at(-1)!,
        );
        fireEvent.click(
            await screen.findByRole('menuitem', { name: 'Delete row' }),
        );
        expect(Object.keys(pending())).toEqual([b, c]);
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(boxes()[0]).not.toBeChecked();
        expect(boxes()[1]).toBeChecked();
        // Delete now removes b, the row still selected, never c.
        const cCell = within(rowOf(0)).getAllByRole('gridcell').at(-1)!;
        fireEvent.mouseDown(cCell);
        fireEvent.keyDown(cCell, { key: 'Delete' });
        expect(Object.keys(pending())).toEqual([c]);
        expect(a).not.toBe(b);
    });

    it('shows an edit staged before a refetch on the same row afterwards, with its first original', () => {
        const { rerender } = renderGrid();
        const input = edit('Ada');
        fireEvent.change(input, { target: { value: 'Ada L.' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        // Another page or sort: the row with id 1 comes back third, loaded with a newer value.
        rerender(
            <div style={{ blockSize: 400 }}>
                <ResultGrid
                    columns={editColumns}
                    rows={[
                        ['Grace', 2],
                        ['Linus', 3],
                        ['Ada (new)', 1],
                    ]}
                    rowMenu={{ dialect: 'pgsql', table: 'users' }}
                    editing={editing({
                        rowIds: [
                            { key: { id: 2 } },
                            { key: { id: 3 } },
                            { key: { id: 1 } },
                        ],
                        locked: [[], [], []],
                        shortened: [[], [], []],
                    })}
                />
            </div>,
        );
        const edited = cell(/Ada L\./);
        expect(edited.closest('[role="row"]')).toBe(
            screen.getAllByRole('row')[3],
        );
        expect(edited.querySelector('[data-edited]')).toHaveAttribute(
            'title',
            'Original: Ada',
        );
    });

    it('stages an edit of a key column under the row’s original identity', () => {
        renderGrid({
            columns: [editColumns[1], editColumns[0]],
            rows: editRows.map(([name, id]) => [id, name]),
        });
        const input = edit('1');
        fireEvent.change(input, { target: { value: '10' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(pending()).toEqual({
            [ref1]: expect.objectContaining({
                id: { key: { id: 1 } },
                original: { id: 1, name: 'Ada' },
                values: { id: '10' },
            }),
        });
    });
});

describe('editing a date cell', () => {
    const dateColumns: QueryColumn[] = [
        { name: 'created_at', type: 'timestamptz', table: 'orders' },
        { name: 'note', type: 'text', table: 'orders' },
    ];
    const meta = (name: string, type_name: string) => ({
        name,
        type: type_name,
        type_name,
        nullable: true,
        default: null,
        auto_increment: false,
        comment: null,
    });
    const dateEditing = (): GridEditing => ({
        connectionId: 1,
        table: 'orders',
        dialect: 'pgsql',
        rowIds: [{ key: { id: 1 } }],
        locked: [[]],
        shortened: [[]],
        readOnlyColumns: [],
        rowReason: null,
        tableColumns: [
            meta('created_at', 'timestamp with time zone'),
            meta('note', 'text'),
        ],
    });
    const ref = refOf({ key: { id: 1 } });
    const pending = () => usePending.getState().byTable['1:orders'] ?? {};
    const renderGrid = (columns = dateColumns) =>
        render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid
                    columns={columns}
                    rows={[
                        columns[0] === dateColumns[0]
                            ? ['2026-10-01 12:00:00+08', 'hello']
                            : ['hello', '2026-10-01 12:00:00+08'],
                    ]}
                    editing={dateEditing()}
                />
            </div>,
        );
    const edit = (text: string | RegExp) => {
        fireEvent.doubleClick(screen.getByRole('gridcell', { name: text }));
        return screen.getByRole('textbox');
    };
    const openPicker = async () => {
        const button = screen.getByRole('button', { name: 'Choose date' });
        expect(button).toHaveAttribute('aria-haspopup', 'dialog');
        fireEvent.click(button);
        // The picker is lazy: the first import can be slow in a cold test run.
        return screen.findByRole(
            'button',
            { name: /^15 October 2026/ },
            { timeout: 5000 },
        );
    };

    beforeEach(() => usePending.setState({ byTable: {}, errors: {} }));

    it('offers the calendar button only on date columns', () => {
        renderGrid();
        const input = edit(/^2026-10-01/);
        expect(input).toHaveValue('2026-10-01 12:00:00+08');
        expect(
            screen.getByRole('button', { name: 'Choose date' }),
        ).toBeInTheDocument();
        fireEvent.keyDown(input, { key: 'Escape' });
        cleanup();
        // Only the first columns render in jsdom: the text column comes first here.
        renderGrid([dateColumns[1], dateColumns[0]]);
        edit(/^hello/);
        expect(
            screen.queryByRole('button', { name: 'Choose date' }),
        ).not.toBeInTheDocument();
    });

    it('stages the picked value and closes the editor on Apply', async () => {
        renderGrid();
        edit(/^2026-10-01/);
        fireEvent.click(await openPicker());
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(pending()[ref]).toMatchObject({
            kind: 'update',
            values: { created_at: '2026-10-15 12:00:00+08' },
        });
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
        await waitFor(() =>
            expect(document.activeElement).toHaveAttribute('role', 'gridcell'),
        );
    });

    it('closes only the picker on Escape, keeping the editor and its draft', async () => {
        renderGrid();
        const input = edit(/^2026-10-01/);
        fireEvent.change(input, { target: { value: '2026-10-02 08:00:00' } });
        await openPicker();
        expect(screen.getByLabelText('Date')).toHaveValue('2026-10-02');
        fireEvent.keyDown(screen.getByLabelText('Date'), { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('textbox')).toHaveValue('2026-10-02 08:00:00');
        expect(pending()).toEqual({});
        await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    });

    it('opens the picker from the keyboard with Alt+ArrowDown', async () => {
        renderGrid();
        const input = edit(/^2026-10-01/);
        expect(input).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowDown');
        fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });
        expect(
            await screen.findByRole(
                'button',
                { name: /^15 October 2026/ },
                { timeout: 5000 },
            ),
        ).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'created_at' })).toBe(input);
    });

    it('keeps the editor open when the picker is cancelled', async () => {
        renderGrid();
        edit(/^2026-10-01/);
        await openPicker();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('textbox')).toBeInTheDocument();
        expect(pending()).toEqual({});
    });
});

describe('clearing a cell', () => {
    const meta = (name: string, type_name: string, nullable = true) => ({
        name,
        type: type_name,
        type_name,
        nullable,
        default: null,
        auto_increment: false,
        comment: null,
    });
    const ref = refOf({ key: { id: 1 } });
    const pending = () => usePending.getState().byTable['1:things'] ?? {};
    /** A grid of one column (jsdom renders only the first few) holding `value` in its one row. */
    const renderColumn = (column: ReturnType<typeof meta>, value: QueryCell) =>
        render(
            <div style={{ blockSize: 400 }}>
                <ResultGrid
                    columns={[
                        {
                            name: column.name,
                            type: column.type_name,
                            table: 'things',
                        },
                    ]}
                    rows={[[value]]}
                    editing={{
                        connectionId: 1,
                        table: 'things',
                        dialect: 'mysql',
                        rowIds: [{ key: { id: 1 } }],
                        locked: [[]],
                        shortened: [[]],
                        readOnlyColumns: [],
                        rowReason: null,
                        tableColumns: [column],
                    }}
                />
            </div>,
        );
    const clear = (text: string | RegExp) => {
        fireEvent.doubleClick(screen.getByRole('gridcell', { name: text }));
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        return input;
    };

    beforeEach(() => usePending.setState({ byTable: {}, errors: {} }));

    it('stages NULL for a nullable integer', () => {
        renderColumn(meta('created_by', 'int'), 7);
        clear('7');
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(pending()[ref]).toMatchObject({
            kind: 'update',
            values: { created_by: null },
        });
    });

    it('stages NULL for a nullable date', () => {
        renderColumn(meta('due', 'date'), '2026-10-01');
        clear('2026-10-01');
        expect(pending()[ref]).toMatchObject({ values: { due: null } });
    });

    it('keeps the editor open with an error for a NOT NULL integer, staging nothing', () => {
        renderColumn(meta('qty', 'int', false), 3);
        const input = clear('3');
        expect(screen.getByRole('textbox')).toBe(input);
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent(
            "This column can't be empty: enter a value or revert",
        );
        expect(pending()).toEqual({});
    });

    it.each([
        ['varchar', 'label', 'x'],
        ['enum', 'status', 'open'],
    ])('stages an empty string for a %s', (type, name, value) => {
        renderColumn(meta(name, type), value);
        clear(value);
        expect(pending()[ref]).toMatchObject({ values: { [name]: '' } });
    });

    it('stages NULL for a typed integer cleared in a new row', () => {
        const added = usePending.getState().addRow(1, 'things');
        renderColumn(meta('created_by', 'int'), 7);
        fireEvent.doubleClick(
            screen.getByRole('gridcell', { name: /\(default\)/ }),
        );
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: '5' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(pending()[added]).toMatchObject({ values: { created_by: '5' } });
        clear('5');
        expect(pending()[added]).toEqual({
            kind: 'insert',
            ref: added,
            values: { created_by: null },
        });
    });
});
