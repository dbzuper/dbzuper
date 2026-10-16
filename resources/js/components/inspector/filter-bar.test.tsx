import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RowFilter } from '@/lib/workspace-api';
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

    describe('keyboard', () => {
        const chips = [
            { column: 'a', op: 'eq' as const, value: '1' },
            { column: 'b', op: 'eq' as const, value: '2' },
            { column: 'c', op: 'eq' as const, value: '3' },
        ];
        const remove = (n: string) =>
            screen.getByRole('button', {
                name: new RegExp(`Remove filter ${n}`),
            });

        function Harness() {
            const [filters, setFilters] = useState<RowFilter[]>(chips);
            return (
                <FilterBar
                    columns={['a', 'b', 'c']}
                    filters={filters}
                    onChange={setFilters}
                />
            );
        }

        it('moves focus to the next chip when one is removed', () => {
            render(<Harness />);
            remove('a').focus();
            fireEvent.click(remove('a'));
            expect(remove('b')).toHaveFocus();
        });

        it('moves focus to the previous chip when the last is removed', () => {
            render(<Harness />);
            remove('c').focus();
            fireEvent.click(remove('c'));
            expect(remove('b')).toHaveFocus();
        });

        it('moves focus to the Filter column select when the last chip goes', () => {
            render(<Harness />);
            for (const n of ['a', 'b', 'c']) {
                remove(n).focus();
                fireEvent.click(remove(n));
            }
            expect(screen.getByLabelText('Filter column')).toHaveFocus();
        });

        it('adds the filter on Enter in a select when no value is needed', () => {
            const onChange = vi.fn();
            render(
                <FilterBar
                    columns={columns}
                    filters={[]}
                    onChange={onChange}
                />,
            );
            fireEvent.change(screen.getByLabelText('Filter operator'), {
                target: { value: 'is_null' },
            });
            fireEvent.keyDown(screen.getByLabelText('Filter column'), {
                key: 'Enter',
            });
            expect(onChange).toHaveBeenCalledWith([
                { column: 'id', op: 'is_null' },
            ]);
            onChange.mockClear();
            fireEvent.keyDown(screen.getByLabelText('Filter operator'), {
                key: 'Enter',
            });
            expect(onChange).toHaveBeenCalledTimes(1);
        });

        it('does not add on Enter in a select while a value is still needed', () => {
            const onChange = vi.fn();
            render(
                <FilterBar
                    columns={columns}
                    filters={[]}
                    onChange={onChange}
                />,
            );
            fireEvent.keyDown(screen.getByLabelText('Filter column'), {
                key: 'Enter',
            });
            expect(onChange).not.toHaveBeenCalled();
        });
    });
});
