import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecords } from '@/records/records-store';
import { nodeId, openRoot } from '@/records/trail';
import type { ConnectionSummary } from '@/types/connection';
import type { SchemaSnapshot } from '@/types/schema';
import { useWorkspace } from '@/universe/store';
import RecordsView from './records-view';

const api = vi.hoisted(() => ({ show: vi.fn(), related: vi.fn() }));
vi.mock('@/records/records-api', () => ({ recordsApi: api }));

// jsdom lacks DOMMatrixReadOnly, which React Flow reads the viewport zoom from.
vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
        m22 = 1;
    },
);

const snapshot = {
    driver: 'sqlite',
    tables: [],
    relationships: [],
} as unknown as SchemaSnapshot;
const connection = { id: 1 } as ConnectionSummary;

beforeEach(() => {
    vi.resetAllMocks();
    useWorkspace.getState().reset();
    useRecords.getState().reset();
    useRecords.getState().setConnection(1);
});

describe('RecordsView', () => {
    it('shows the empty state with the ways to open a record', () => {
        render(<RecordsView connection={connection} snapshot={snapshot} />);
        expect(
            screen.getByRole('region', { name: 'Record explorer' }),
        ).toHaveTextContent('Open a record from the Data tab');
    });

    it('renders the trail as cards and shows a dismissible notice', async () => {
        api.show.mockResolvedValue({
            table: 'users',
            key: { id: 1 },
            columns: [
                { name: 'id', type: 'int' },
                { name: 'name', type: 'varchar' },
            ],
            values: [1, 'Ada'],
            relationships: [],
        });
        render(<RecordsView connection={connection} snapshot={snapshot} />);
        act(() => useRecords.getState().open('users', { id: 1 }));
        expect(await screen.findByText('Ada')).toBeInTheDocument();
        expect(screen.getByText('users')).toBeInTheDocument();
        expect(useRecords.getState().trail.nodes[0].id).toBe(
            nodeId('users', { id: 1 }),
        );

        act(() =>
            useRecords.setState({
                trail: { ...openRoot('users', { id: 1 }) },
                notice: 'Trail is full (100 records).',
            }),
        );
        expect(screen.getByRole('status')).toHaveTextContent('Trail is full');
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('offers the Data tab for a table the explorer cannot open', () => {
        render(<RecordsView connection={connection} snapshot={snapshot} />);
        act(() =>
            useRecords.setState({
                notice: 'logs has no primary key; open it in the Data tab instead.',
                noticeTable: 'logs',
            }),
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Open logs in Data tab' }),
        );
        const ws = useWorkspace.getState();
        expect(ws.selected).toBe('logs');
        expect(ws.inspectorTab).toBe('data');
        expect(ws.dataFilter).toBeNull();
    });

    const users = nodeId('users', { id: 1 });
    const orders = nodeId('orders', { id: 5 });
    /** Two cards (users selected, orders not); orders has a has-many port to items. */
    async function twoCards(items: { kind: string; primary_key: string[] }) {
        api.show.mockImplementation((_c: number, table: string) =>
            Promise.resolve({
                table,
                key: table === 'users' ? { id: 1 } : { id: 5 },
                columns: [{ name: 'id', type: 'int' }],
                values: [table === 'users' ? 1 : 5],
                relationships:
                    table === 'orders'
                        ? [
                              {
                                  id: 'fk_items',
                                  direction: 'in',
                                  table: 'items',
                                  columns: ['order_id'],
                                  other_columns: ['id'],
                                  inferred: false,
                                  available: true,
                                  count: { value: 2, capped: false },
                              },
                          ]
                        : [],
            }),
        );
        api.related.mockReturnValue(new Promise(() => {}));
        const withItems = {
            ...snapshot,
            tables: [
                {
                    name: 'items',
                    ...items,
                    columns: [{ name: 'id', type: 'int' }],
                },
            ],
        } as unknown as SchemaSnapshot;
        render(<RecordsView connection={connection} snapshot={withItems} />);
        act(() =>
            useRecords.getState().setTrail({
                nodes: [
                    { id: users, table: 'users', key: { id: 1 } },
                    { id: orders, table: 'orders', key: { id: 5 } },
                ],
                edges: [],
                selected: users,
            }),
        );
    }
    // jsdom never measures nodes, so React Flow keeps them visibility: hidden (no accessible name).
    const button = (label: string) =>
        vi.waitFor(() => {
            const found = document.querySelector<HTMLButtonElement>(
                `button[aria-label="${label}"]`,
            );
            expect(found).not.toBeNull();
            return found!;
        });

    it('a port click on an unselected card does not select it', async () => {
        await twoCards({ kind: 'table', primary_key: ['id'] });
        const port = await button('Show items (order_id) — 2 records');
        const before = useRecords.getState().trail;
        fireEvent.click(port);
        expect(api.related).toHaveBeenCalledOnce();
        expect(useRecords.getState().trail).toBe(before);
        expect(useRecords.getState().trail.selected).toBe(users);
    });

    it('a port to a table without a primary key opens the Data tab filtered on this record', async () => {
        await twoCards({ kind: 'table', primary_key: [] });
        fireEvent.click(await button('Open items (order_id) in Data tab'));
        expect(api.related).not.toHaveBeenCalled();
        const ws = useWorkspace.getState();
        expect(ws.selected).toBe('items');
        expect(ws.inspectorTab).toBe('data');
        expect(ws.dataFilter).toEqual({
            table: 'items',
            filters: [{ column: 'order_id', value: '5' }],
        });
    });
});
