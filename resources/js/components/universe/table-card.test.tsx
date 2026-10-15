import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeTable } from '@/universe/__fixtures__/snapshot';
import { TableCard } from './table-card';

const columns = Array.from({ length: 14 }, (_, i) => ({
    name: i === 0 ? 'id' : `col_${i}`,
    type: 'varchar(255)',
    type_name: 'varchar',
    nullable: true,
    default: null,
    auto_increment: false,
    comment: null,
}));

describe('TableCard', () => {
    it('shows name, rows, the first 10 columns and a remainder', () => {
        render(
            <TableCard
                table={makeTable({
                    name: 'orders',
                    columns,
                    row_count: { count: 1234, kind: 'estimate' },
                })}
                fk={{
                    declared: new Set(['col_1']),
                    inferred: new Set(['col_2']),
                }}
                selected={false}
                onSelect={() => {}}
            />,
        );
        expect(
            screen.getByRole('button', { name: 'Table orders' }),
        ).toBeInTheDocument();
        expect(screen.getByText('~1.2K rows')).toBeInTheDocument();
        expect(screen.getByText('col_9')).toBeInTheDocument();
        expect(screen.queryByText('col_10')).not.toBeInTheDocument();
        expect(screen.getByText('+4 more')).toBeInTheDocument();
        expect(screen.getByLabelText('primary key')).toBeInTheDocument();
        expect(screen.getByLabelText('foreign key')).toBeInTheDocument();
        expect(
            screen.getByLabelText('inferred foreign key'),
        ).toBeInTheDocument();
    });

    it('selects on Enter and Space', () => {
        const onSelect = vi.fn();
        render(
            <TableCard
                table={makeTable({ name: 'orders' })}
                fk={{ declared: new Set(), inferred: new Set() }}
                selected={false}
                onSelect={onSelect}
            />,
        );
        const card = screen.getByRole('button', { name: 'Table orders' });
        fireEvent.keyDown(card, { key: 'Enter' });
        fireEvent.keyDown(card, { key: ' ' });
        expect(onSelect).toHaveBeenCalledTimes(2);
        expect(onSelect).toHaveBeenCalledWith('orders');
    });

    it('marks views and reports clicks', () => {
        const onSelect = vi.fn();
        render(
            <TableCard
                table={makeTable({ name: 'v', kind: 'view' })}
                fk={{ declared: new Set(), inferred: new Set() }}
                selected
                onSelect={onSelect}
            />,
        );
        expect(screen.getByText('view')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Table v' }));
        expect(onSelect).toHaveBeenCalledWith('v');
    });
});
