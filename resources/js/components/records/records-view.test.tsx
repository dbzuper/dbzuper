import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecords } from '@/records/records-store';
import { nodeId, openRoot } from '@/records/trail';
import type { ConnectionSummary } from '@/types/connection';
import type { SchemaSnapshot } from '@/types/schema';
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
});
