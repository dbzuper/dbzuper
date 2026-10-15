import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SchemaSnapshot } from '@/types/schema';
import { TableList } from './table-list';

const snapshot: SchemaSnapshot = {
    driver: 'sqlite',
    database: 'x',
    schema: 'main',
    generated_at: '2026-10-14T00:00:00Z',
    hash: 'h',
    tables: [
        {
            name: 'users',
            kind: 'table',
            row_count: { count: 3, kind: 'exact' },
            size_bytes: null,
            primary_key: ['id'],
            columns: [],
            indexes: [],
        },
        {
            name: 'order_totals',
            kind: 'view',
            row_count: { count: null, kind: 'unknown' },
            size_bytes: null,
            primary_key: [],
            columns: [],
            indexes: [],
        },
    ],
    relationships: [
        {
            id: 'r1',
            from_table: 'orders',
            from_columns: ['user_id'],
            to_table: 'users',
            to_columns: ['id'],
            inferred: true,
            confidence: 0.9,
            name: null,
        },
    ],
};

describe('TableList', () => {
    it('lists tables and views with counts and relationship totals', () => {
        render(<TableList snapshot={snapshot} filter="" />);
        expect(screen.getByText('users')).toBeInTheDocument();
        expect(screen.getByText('view')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByLabelText('users relationships')).toHaveTextContent(
            '1',
        );
    });

    it('filters by name', () => {
        render(<TableList snapshot={snapshot} filter="order" />);
        expect(screen.queryByText('users')).not.toBeInTheDocument();
        expect(screen.getByText('order_totals')).toBeInTheDocument();
    });

    it('reports row selection', () => {
        const onSelect = vi.fn();
        render(
            <TableList
                snapshot={snapshot}
                filter=""
                onSelect={onSelect}
                selected="users"
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'users' }));
        expect(onSelect).toHaveBeenCalledWith('users');
    });
});
