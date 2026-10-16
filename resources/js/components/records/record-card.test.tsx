import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import type { RecordEntry } from '@/records/records-store';
import type { RecordPayload, RelationshipSummary } from '@/records/types';
import { CARD_MAX_HEIGHT } from '@/records/trail';
import { RecordCard } from './record-card';

const summary = (p: Partial<RelationshipSummary>): RelationshipSummary => ({
    id: 'fk',
    direction: 'out',
    table: 'users',
    columns: ['user_id'],
    other_columns: ['id'],
    inferred: false,
    available: true,
    count: null,
    ...p,
});

const payload = (relationships: RelationshipSummary[]): RecordPayload => ({
    table: 'orders',
    key: { id: 7 },
    columns: [
        { name: 'id', type: 'int' },
        { name: 'name', type: 'varchar' },
        { name: 'status', type: 'varchar' },
        { name: 'note', type: 'text' },
        { name: 'a', type: 'int' },
        { name: 'b', type: 'int' },
        { name: 'c', type: 'int' },
        { name: 'd', type: 'int' },
    ],
    values: [7, 'Order seven', 'paid', null, 1, 2, 3, 4],
    relationships,
});

const ready = (relationships: RelationshipSummary[] = []): RecordEntry => ({
    status: 'ready',
    payload: payload(relationships),
});

function setup(
    entry: RecordEntry,
    props: Partial<React.ComponentProps<typeof RecordCard>> = {},
) {
    const onExpand = vi.fn();
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    const onReload = vi.fn();
    const onOpenInData = vi.fn();
    render(
        <ReactFlowProvider>
            <RecordCard
                table="orders"
                recordKey={{ id: 7 }}
                entry={entry}
                selected={false}
                showInferred
                onExpand={onExpand}
                onSelect={onSelect}
                onRemove={onRemove}
                onReload={onReload}
                onOpenInData={onOpenInData}
                {...props}
            />
        </ReactFlowProvider>,
    );
    return { onExpand, onSelect, onRemove, onReload, onOpenInData };
}

describe('RecordCard', () => {
    it('renders the heuristic title and up to five fields with their column names', () => {
        setup(ready());
        expect(screen.getByText('Order seven')).toBeInTheDocument();
        const fields = screen.getByRole('group', { name: 'Fields' });
        const names = within(fields)
            .getAllByRole('term')
            .map((t) => t.textContent);
        expect(names).toEqual(['id', 'status', 'note', 'a', 'b']);
        expect(screen.getByText('paid')).toBeInTheDocument();
    });

    it('scrolls inside a capped card without zooming the canvas', () => {
        setup(ready());
        const scroller = screen.getByRole('group', {
            name: 'Fields',
        }).parentElement!;
        // nodrag: pressing the (always visible on Windows) scrollbar must scroll, not drag the card.
        expect(scroller).toHaveClass('nowheel', 'nodrag', 'overflow-y-auto');
        expect(scroller.parentElement).toHaveStyle({
            maxHeight: `${CARD_MAX_HEIGHT}px`,
        });
    });

    it('renders NULL with data-null', () => {
        setup(ready());
        expect(screen.getByText('NULL')).toHaveAttribute('data-null', 'true');
    });

    it('draws a preview before the record is loaded and shows a port skeleton', () => {
        setup({
            status: 'loading',
            preview: {
                columns: [
                    { name: 'id', type: 'int' },
                    { name: 'email', type: 'varchar' },
                ],
                values: [3, 'a@b.c'],
                primaryKey: ['id'],
            },
        });
        expect(screen.getAllByText('a@b.c').length).toBeGreaterThan(0);
        expect(screen.getByText('Loading relationships')).toBeInTheDocument();
    });

    it('offers an outgoing port that opens the parent', () => {
        const s = summary({});
        const { onExpand } = setup(ready([s]));
        const port = screen.getByRole('button', {
            name: 'Open users (user_id)',
        });
        expect(port).toHaveTextContent('users');
        fireEvent.click(port);
        expect(onExpand).toHaveBeenCalledWith(s);
    });

    it('opens a parent that cannot be explored in the Data tab, filtered on its key', () => {
        const s = summary({
            table: 'blobs',
            columns: ['a'],
            other_columns: ['id'],
        });
        const { onExpand, onOpenInData } = setup(ready([s]), {
            isExplorable: (t) => t !== 'blobs',
        });
        fireEvent.click(
            screen.getByRole('button', { name: 'Open blobs (a) in Data tab' }),
        );
        expect(onOpenInData).toHaveBeenCalledWith('blobs', [
            { column: 'id', value: '1' },
        ]);
        expect(onExpand).not.toHaveBeenCalled();
    });

    it('opens children that cannot be explored in the Data tab, filtered on this record', () => {
        const s = summary({
            direction: 'in',
            table: 'audit_log',
            columns: ['order_id', 'shop'],
            other_columns: ['id', 'b'],
            count: { value: 3, capped: false },
        });
        const { onExpand, onOpenInData } = setup(ready([s]), {
            isExplorable: () => false,
        });
        fireEvent.click(
            screen.getByRole('button', {
                name: 'Open audit_log (order_id, shop) in Data tab',
            }),
        );
        expect(onOpenInData).toHaveBeenCalledWith('audit_log', [
            { column: 'order_id', value: '7' },
            { column: 'shop', value: '2' },
        ]);
        expect(onExpand).not.toHaveBeenCalled();
    });

    it('disables an outgoing port whose key is NULL', () => {
        const { onExpand } = setup(ready([summary({ available: false })]));
        const port = screen.getByRole('button', {
            name: 'Open users (user_id)',
        });
        expect(port).toBeDisabled();
        expect(port).toHaveAttribute('title', 'No related record (NULL)');
        fireEvent.click(port);
        expect(onExpand).not.toHaveBeenCalled();
    });

    it.each([
        [
            { value: 2, capped: false },
            '2',
            'Show order_items (order_id) 2 records',
        ],
        [
            { value: 1, capped: false },
            '1',
            'Show order_items (order_id) 1 record',
        ],
        [
            { value: 10000, capped: true },
            '10,000+',
            'Show order_items (order_id) 10,000+ records',
        ],
        [null, '?', 'Show order_items (order_id) ? records'],
    ])('shows the incoming count %j', (count, text, label) => {
        const s = summary({
            id: 'in1',
            direction: 'in',
            table: 'order_items',
            columns: ['order_id'],
            count,
        });
        const { onExpand } = setup(ready([s]));
        const port = screen.getByRole('button', { name: label });
        expect(port).toHaveTextContent(text);
        expect(port).toBeEnabled();
        fireEvent.click(port);
        expect(onExpand).toHaveBeenCalledWith(s);
    });

    it('disables an incoming port with no rows', () => {
        setup(
            ready([
                summary({
                    direction: 'in',
                    table: 'order_items',
                    columns: ['order_id'],
                    count: { value: 0, capped: false },
                }),
            ]),
        );
        expect(
            screen.getByRole('button', {
                name: 'Show order_items (order_id) 0 records',
            }),
        ).toBeDisabled();
    });

    it('joins composite columns in the port label', () => {
        setup(ready([summary({ columns: ['a_id', 'b_id'] })]));
        expect(
            screen.getByRole('button', { name: 'Open users (a_id, b_id)' }),
        ).toBeInTheDocument();
    });

    it('marks inferred ports with data-inferred', () => {
        setup(ready([summary({ inferred: true })]));
        expect(
            screen.getByRole('button', { name: 'Open users (user_id)' }),
        ).toHaveAttribute('data-inferred', 'true');
    });

    it('does not render inferred ports when showInferred is false', () => {
        setup(ready([summary({ inferred: true })]), { showInferred: false });
        expect(
            screen.queryByRole('button', { name: /Open users/ }),
        ).not.toBeInTheDocument();
    });

    it('keeps a handle for every edge even when its port is hidden or not drawn yet', () => {
        const handle = (id: string) =>
            document.querySelector(
                `.react-flow__handle[data-handleid="${id}"]`,
            );
        const { unmount } = render(
            <ReactFlowProvider>
                <RecordCard
                    table="orders"
                    recordKey={{ id: 7 }}
                    entry={ready([summary({ id: 'inf', inferred: true })])}
                    selected={false}
                    showInferred={false}
                    edgeHandles={['inf:out', 'later:in']}
                    onExpand={vi.fn()}
                    onSelect={vi.fn()}
                    onRemove={vi.fn()}
                    onReload={vi.fn()}
                />
            </ReactFlowProvider>,
        );
        expect(handle('inf:out')).not.toBeNull();
        expect(handle('later:in')).not.toBeNull();
        unmount();
    });

    it('does not duplicate the handle of a drawn port', () => {
        setup(ready([summary({ id: 'fk' })]), { edgeHandles: ['fk:out'] });
        expect(
            document.querySelectorAll(
                '.react-flow__handle[data-handleid="fk:out"]',
            ),
        ).toHaveLength(1);
    });

    it('keeps edge handles on a missing card', () => {
        setup({ status: 'missing' }, { edgeHandles: ['fk:in'] });
        expect(
            document.querySelector(
                '.react-flow__handle[data-handleid="fk:in"]',
            ),
        ).not.toBeNull();
    });

    it('selects the card from its header', () => {
        const { onSelect } = setup(ready());
        fireEvent.click(screen.getByRole('button', { name: /Order seven/ }));
        expect(onSelect).toHaveBeenCalled();
    });

    it('shows a missing record with a remove button', () => {
        const { onRemove } = setup({ status: 'missing' });
        expect(screen.getByText('orders · id=7 not found')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
        expect(onRemove).toHaveBeenCalled();
    });

    it('selects a missing record from its title', () => {
        const { onSelect } = setup({ status: 'missing' });
        fireEvent.click(
            screen.getByRole('button', { name: 'orders · id=7 not found' }),
        );
        expect(onSelect).toHaveBeenCalled();
    });

    it('shows a load error with a retry button', () => {
        const { onReload } = setup({ status: 'error', error: 'Boom' });
        expect(screen.getByText('Boom')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(onReload).toHaveBeenCalled();
    });
});
