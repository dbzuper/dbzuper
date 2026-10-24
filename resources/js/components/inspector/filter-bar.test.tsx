import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DATE_OPS, type DateKind, quickRanges } from '@/lib/date-filter';
import type { RowFilter } from '@/lib/workspace-api';
import { FilterBar, filterChipText } from './filter-bar';
import { loadDatePicker } from './load-date-picker';

const preloadDatePicker = vi.hoisted(() => vi.fn());
vi.mock('./load-date-picker', async (orig) => ({
    ...(await orig<typeof import('./load-date-picker')>()),
    preloadDatePicker,
}));

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

        it('does not move focus when the filters change without a removal', () => {
            const { rerender } = render(
                <FilterBar
                    columns={columns}
                    filters={chips.slice(0, 2)}
                    onChange={vi.fn()}
                />,
            );
            const remove = (n: string) =>
                screen.getByRole('button', {
                    name: new RegExp(`Remove filter ${n}`),
                });
            remove('a').focus();
            // A removal that the parent did not apply (the list is unchanged) leaves a stale flag.
            fireEvent.click(remove('a'));
            const input = screen.getByLabelText('Filter operator');
            input.focus();
            rerender(
                <FilterBar
                    columns={columns}
                    filters={chips}
                    onChange={vi.fn()}
                />,
            );
            expect(input).toHaveFocus();
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

    it('starts a draft for a column and focuses the value input', () => {
        const { rerender } = render(
            <FilterBar
                columns={['id', 'name']}
                filters={[]}
                onChange={vi.fn()}
                draft={null}
            />,
        );
        rerender(
            <FilterBar
                columns={['id', 'name']}
                filters={[]}
                onChange={vi.fn()}
                draft={{ column: 'name', nonce: 1 }}
            />,
        );
        expect(screen.getByLabelText('Filter column')).toHaveValue('name');
        expect(screen.getByLabelText('Filter operator')).toHaveValue(
            'contains',
        );
        expect(screen.getByLabelText('Filter value')).toHaveFocus();
    });

    it('puts the first control id on the column select', () => {
        render(
            <FilterBar
                id="the-filter"
                columns={columns}
                filters={[]}
                onChange={vi.fn()}
            />,
        );
        expect(screen.getByLabelText('Filter column')).toHaveAttribute(
            'id',
            'the-filter',
        );
    });
    describe('date columns', () => {
        const dateColumns = ['name', 'created_at'];
        const dateKinds = { created_at: 'datetime' as const };
        const operator = () =>
            screen.getByLabelText('Filter operator') as HTMLSelectElement;

        function renderDates(onChange = vi.fn()) {
            render(
                <FilterBar
                    columns={dateColumns}
                    filters={[]}
                    onChange={onChange}
                    dateKinds={dateKinds}
                />,
            );
            fireEvent.change(screen.getByLabelText('Filter column'), {
                target: { value: 'created_at' },
            });
            return onChange;
        }

        async function openPicker() {
            fireEvent.click(
                screen.getByRole('button', { name: /^Filter value/ }),
            );
            return screen.findByRole('dialog');
        }

        it('defaults to on and lists the date operators', () => {
            renderDates();
            expect(operator()).toHaveValue('on');
            expect([...operator().options].map((o) => o.value)).toEqual(
                DATE_OPS,
            );
            expect(
                within(operator()).getByRole('option', { name: 'before' }),
            ).toHaveValue('lt');
        });

        it('keeps the date operators off text columns', () => {
            renderDates();
            fireEvent.change(screen.getByLabelText('Filter column'), {
                target: { value: 'name' },
            });
            const values = [...operator().options].map((o) => o.value);
            expect(values).not.toContain('on');
            expect(values).not.toContain('between');
            expect(values).not.toContain('after');
        });

        it('shows a picker button for the value', () => {
            renderDates();
            const button = screen.getByRole('button', {
                name: /^Filter value/,
            });
            expect(button.tagName).toBe('BUTTON');
            expect(button).toHaveAttribute('aria-haspopup', 'dialog');
            expect(button).toHaveTextContent('Pick a date…');
        });

        it('preloads the picker when a date column is selected', () => {
            render(
                <FilterBar
                    columns={dateColumns}
                    filters={[]}
                    onChange={vi.fn()}
                    dateKinds={dateKinds}
                />,
            );
            preloadDatePicker.mockClear();
            fireEvent.change(screen.getByLabelText('Filter column'), {
                target: { value: 'created_at' },
            });
            expect(preloadDatePicker).toHaveBeenCalled();
        });

        it('does not preload the picker for text columns only', () => {
            preloadDatePicker.mockClear();
            render(
                <FilterBar columns={columns} filters={[]} onChange={vi.fn()} />,
            );
            fireEvent.change(screen.getByLabelText('Filter column'), {
                target: { value: 'status' },
            });
            expect(preloadDatePicker).not.toHaveBeenCalled();
        });

        it.each(['pointerEnter', 'focus'] as const)(
            'preloads the picker on %s of the value button',
            (event) => {
                renderDates();
                preloadDatePicker.mockClear();
                fireEvent[event](
                    screen.getByRole('button', { name: /^Filter value/ }),
                );
                expect(preloadDatePicker).toHaveBeenCalled();
            },
        );

        it('opens a preloaded picker without a loading spinner', async () => {
            await loadDatePicker();
            renderDates();
            fireEvent.click(
                screen.getByRole('button', { name: /^Filter value/ }),
            );
            const dialog = screen.getByRole('dialog');
            expect(
                within(dialog).queryByRole('status', { name: 'Loading' }),
            ).toBeNull();
            expect(within(dialog).getByRole('grid')).toBeInTheDocument();
        });

        it('resets between to equals on a text column and sends no to', () => {
            const onChange = renderDates();
            fireEvent.change(operator(), { target: { value: 'between' } });
            fireEvent.change(screen.getByLabelText('Filter column'), {
                target: { value: 'name' },
            });
            expect(operator()).toHaveValue('eq');
            fireEvent.change(screen.getByLabelText('Filter value'), {
                target: { value: 'ada' },
            });
            fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
            expect(onChange).toHaveBeenCalledWith([
                { column: 'name', op: 'eq', value: 'ada' },
            ]);
        });

        it('keeps an operator the new kind offers and picks on otherwise', () => {
            renderDates();
            fireEvent.change(screen.getByLabelText('Filter column'), {
                target: { value: 'name' },
            });
            fireEvent.change(operator(), { target: { value: 'contains' } });
            fireEvent.change(screen.getByLabelText('Filter column'), {
                target: { value: 'created_at' },
            });
            expect(operator()).toHaveValue('on');
            fireEvent.change(operator(), { target: { value: 'is_null' } });
            fireEvent.change(screen.getByLabelText('Filter column'), {
                target: { value: 'name' },
            });
            expect(operator()).toHaveValue('is_null');
        });

        it('adds a between filter from Apply in the picker', async () => {
            const onChange = renderDates();
            fireEvent.change(operator(), { target: { value: 'between' } });
            await openPicker();
            fireEvent.change(await screen.findByLabelText('From'), {
                target: { value: '2026-10-01' },
            });
            fireEvent.change(screen.getByLabelText('To'), {
                target: { value: '2026-10-15' },
            });
            fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
            expect(onChange).toHaveBeenCalledWith([
                {
                    column: 'created_at',
                    op: 'between',
                    value: '2026-10-01',
                    to: '2026-10-15',
                },
            ]);
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            // Radix returns focus to the trigger on the next tick.
            await waitFor(() =>
                expect(
                    screen.getByRole('button', { name: /^Filter value/ }),
                ).toHaveFocus(),
            );
        });

        it('adds a same-day date-only range as on', async () => {
            const onChange = renderDates();
            fireEvent.change(operator(), { target: { value: 'between' } });
            await openPicker();
            fireEvent.change(await screen.findByLabelText('From'), {
                target: { value: '2026-10-23' },
            });
            fireEvent.change(screen.getByLabelText('To'), {
                target: { value: '2026-10-23' },
            });
            fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
            expect(onChange).toHaveBeenCalledWith([
                { column: 'created_at', op: 'on', value: '2026-10-23' },
            ]);
        });

        it('rejects a typed time for on in the picker', async () => {
            const onChange = renderDates();
            expect(operator()).toHaveValue('on');
            await openPicker();
            fireEvent.change(await screen.findByLabelText('Date'), {
                target: { value: '2026-10-01 14:00' },
            });
            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(
                screen.getByRole('button', { name: 'Apply' }),
            ).toBeDisabled();
            expect(onChange).not.toHaveBeenCalled();
        });

        it('refuses on 9999-12-31 in the picker but takes it for before', async () => {
            const onChange = renderDates();
            await openPicker();
            fireEvent.change(await screen.findByLabelText('Date'), {
                target: { value: '9999-12-31' },
            });
            expect(screen.getByRole('alert')).toHaveTextContent(
                'That date is too late to filter by',
            );
            expect(
                screen.getByRole('button', { name: 'Apply' }),
            ).toBeDisabled();
            fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
            fireEvent.change(operator(), { target: { value: 'lt' } });
            await openPicker();
            fireEvent.change(await screen.findByLabelText('Date'), {
                target: { value: '9999-12-31' },
            });
            fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
            expect(onChange).toHaveBeenCalledWith([
                { column: 'created_at', op: 'lt', value: '9999-12-31' },
            ]);
        });

        it('refuses a date-only between end of 9999-12-31 in the picker', async () => {
            const onChange = renderDates();
            fireEvent.change(operator(), { target: { value: 'between' } });
            await openPicker();
            fireEvent.change(await screen.findByLabelText('From'), {
                target: { value: '2026-10-01' },
            });
            fireEvent.change(screen.getByLabelText('To'), {
                target: { value: '9999-12-31' },
            });
            expect(screen.getByRole('alert')).toHaveTextContent(
                'That date is too late to filter by',
            );
            fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
            expect(onChange).not.toHaveBeenCalled();
        });

        it('drops text typed for another column when a date column draft starts', () => {
            const onChange = vi.fn();
            const props = {
                columns: dateColumns,
                filters: [],
                onChange,
                dateKinds,
            };
            const { rerender } = render(<FilterBar {...props} draft={null} />);
            fireEvent.change(screen.getByLabelText('Filter value'), {
                target: { value: 'ada' },
            });
            rerender(
                <FilterBar
                    {...props}
                    draft={{ column: 'created_at', nonce: 1 }}
                />,
            );
            expect(operator()).toHaveValue('on');
            expect(
                screen.getByRole('button', { name: /^Filter value/ }),
            ).toHaveTextContent('Pick a date…');
            const add = screen.getByRole('button', { name: 'Add filter' });
            expect(add).toBeDisabled();
            fireEvent.click(add);
            expect(onChange).not.toHaveBeenCalled();
        });

        it('adds a single-date filter without to', async () => {
            const onChange = renderDates();
            fireEvent.change(operator(), { target: { value: 'after' } });
            await openPicker();
            fireEvent.change(await screen.findByLabelText('Date'), {
                target: { value: '2026-10-15' },
            });
            fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
            expect(onChange).toHaveBeenCalledWith([
                { column: 'created_at', op: 'after', value: '2026-10-15' },
            ]);
        });

        it('applies a quick range as between and switches the operator', async () => {
            const onChange = renderDates();
            await openPicker();
            fireEvent.click(
                await screen.findByRole('button', { name: 'Last 7 days' }),
            );
            const range = quickRanges(new Date())[2];
            expect(onChange).toHaveBeenCalledWith([
                {
                    column: 'created_at',
                    op: 'between',
                    value: range.from,
                    to: range.to,
                },
            ]);
            expect(operator()).toHaveValue('between');
        });

        it('applies a single-day quick range as on', async () => {
            const onChange = renderDates();
            await openPicker();
            fireEvent.click(
                await screen.findByRole('button', { name: 'Today' }),
            );
            const today = quickRanges(new Date())[0].from;
            expect(onChange).toHaveBeenCalledWith([
                { column: 'created_at', op: 'on', value: today },
            ]);
        });

        function StatefulDates() {
            const [filters, setFilters] = useState<RowFilter[]>([]);
            return (
                <FilterBar
                    columns={dateColumns}
                    filters={filters}
                    onChange={setFilters}
                    dateKinds={dateKinds}
                />
            );
        }

        it('shows on in the operator select after the Today quick range', async () => {
            render(<StatefulDates />);
            fireEvent.change(screen.getByLabelText('Filter column'), {
                target: { value: 'created_at' },
            });
            await openPicker();
            fireEvent.click(
                await screen.findByRole('button', { name: 'Today' }),
            );
            expect(screen.getByRole('listitem')).toHaveTextContent(
                /^created_at on /,
            );
            expect(operator()).toHaveValue('on');
        });

        it('shows on in the operator select after a same-day range is applied', async () => {
            render(<StatefulDates />);
            fireEvent.change(screen.getByLabelText('Filter column'), {
                target: { value: 'created_at' },
            });
            fireEvent.change(operator(), { target: { value: 'between' } });
            await openPicker();
            fireEvent.change(await screen.findByLabelText('From'), {
                target: { value: '2026-10-23' },
            });
            fireEvent.change(screen.getByLabelText('To'), {
                target: { value: '2026-10-23' },
            });
            fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
            expect(screen.getByRole('listitem')).toHaveTextContent(
                'created_at on 23 Oct 2026',
            );
            expect(operator()).toHaveValue('on');
        });

        it('closes on Escape without adding and refocuses the value button', async () => {
            const onChange = renderDates();
            const dialog = await openPicker();
            await screen.findByLabelText('Date');
            fireEvent.keyDown(dialog, { key: 'Escape' });
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(onChange).not.toHaveBeenCalled();
            // Radix returns focus to the trigger on the next tick.
            await waitFor(() =>
                expect(
                    screen.getByRole('button', { name: /^Filter value/ }),
                ).toHaveFocus(),
            );
        });

        it('shows date chips with formatted values', () => {
            render(
                <FilterBar
                    columns={dateColumns}
                    filters={[
                        {
                            column: 'created_at',
                            op: 'between',
                            value: '2026-10-01',
                            to: '2026-10-15',
                        },
                    ]}
                    onChange={vi.fn()}
                    dateKinds={dateKinds}
                />,
            );
            expect(
                screen.getByText('created_at between 1 Oct 2026 → 15 Oct 2026'),
            ).toBeInTheDocument();
        });
    });

    describe('filterChipText', () => {
        it.each<[RowFilter, DateKind | null, string]>([
            [
                {
                    column: 'created_at',
                    op: 'between',
                    value: '2026-10-01',
                    to: '2026-10-15',
                },
                'datetime',
                'created_at between 1 Oct 2026 → 15 Oct 2026',
            ],
            [
                { column: 'created_at', op: 'on', value: '2026-10-15' },
                'datetime',
                'created_at on 15 Oct 2026',
            ],
            [
                { column: 'created_at', op: 'lt', value: '2026-10-15' },
                'date',
                'created_at before 15 Oct 2026',
            ],
            [
                {
                    column: 'created_at',
                    op: 'after',
                    value: '2026-10-15 14:00:00',
                },
                'datetime',
                'created_at after 15 Oct 2026 14:00',
            ],
            [
                { column: 'created_at', op: 'is_null' },
                'datetime',
                'created_at is null',
            ],
            [
                { column: 'status', op: 'eq', value: 'paid' },
                null,
                'status equals paid',
            ],
            [{ column: 'total', op: 'lt', value: '100' }, null, 'total < 100'],
            [
                { column: 'created_at', op: 'eq', value: 'yesterday' },
                'datetime',
                'created_at equals yesterday',
            ],
        ])('%o as %s reads %s', (filter, kind, text) => {
            expect(filterChipText(filter, kind)).toBe(text);
        });
    });
});
