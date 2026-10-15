import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar } from './filter-bar';

const columns = ['id', 'status'];

describe('FilterBar', () => {
    it('adds a filter from the column, operator and value', () => {
        const onChange = vi.fn();
        render(
            <FilterBar columns={columns} filters={[]} onChange={onChange} />,
        );
        fireEvent.change(screen.getByLabelText('Filter column'), {
            target: { value: 'status' },
        });
        fireEvent.change(screen.getByLabelText('Filter operator'), {
            target: { value: 'eq' },
        });
        fireEvent.change(screen.getByLabelText('Filter value'), {
            target: { value: 'paid' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
        expect(onChange).toHaveBeenCalledWith([
            { column: 'status', op: 'eq', value: 'paid' },
        ]);
    });

    it('hides the value input for is null and allows adding without a value', () => {
        const onChange = vi.fn();
        render(
            <FilterBar columns={columns} filters={[]} onChange={onChange} />,
        );
        fireEvent.change(screen.getByLabelText('Filter operator'), {
            target: { value: 'is_null' },
        });
        expect(screen.queryByLabelText('Filter value')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
        expect(onChange).toHaveBeenCalledWith([
            { column: 'id', op: 'is_null' },
        ]);
    });

    it('disables Add filter until a value is typed', () => {
        render(<FilterBar columns={columns} filters={[]} onChange={vi.fn()} />);
        expect(
            screen.getByRole('button', { name: 'Add filter' }),
        ).toBeDisabled();
    });

    it('removes a chip', () => {
        const onChange = vi.fn();
        render(
            <FilterBar
                columns={columns}
                filters={[{ column: 'status', op: 'eq', value: 'paid' }]}
                onChange={onChange}
            />,
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'Remove filter status equals paid',
            }),
        );
        expect(onChange).toHaveBeenCalledWith([]);
    });
});
