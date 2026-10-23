import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { quickRanges } from '@/lib/date-filter';
import DatePicker from './date-picker';

const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

function renderPicker(props: Partial<Parameters<typeof DatePicker>[0]> = {}) {
    const handlers = {
        onApply: vi.fn(),
        onQuickRange: vi.fn(),
        onCancel: vi.fn(),
    };
    render(
        <DatePicker
            kind="datetime"
            mode="range"
            value=""
            {...handlers}
            {...props}
        />,
    );
    return handlers;
}

describe('DatePicker', () => {
    it('applies a reversed range in order', () => {
        const { onApply } = renderPicker();
        type('From', '2026-10-15');
        type('To', '2026-10-01');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onApply).toHaveBeenCalledWith('2026-10-01', '2026-10-15');
    });

    it('swaps by the effective end, not by string order', () => {
        const { onApply } = renderPicker();
        // The same day with a time is still inside the date-only end's whole day.
        type('From', '2026-10-15 10:00');
        type('To', '2026-10-15');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onApply).toHaveBeenCalledWith(
            '2026-10-15 10:00:00',
            '2026-10-15',
        );
    });

    it('shows the time-zone error and disables Apply', () => {
        renderPicker({ mode: 'single' });
        type('Date', '2026-10-01T14:00:00Z');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Time zones aren’t supported',
        );
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
        expect(screen.getByLabelText('Date')).toHaveAttribute(
            'aria-invalid',
            'true',
        );
    });

    it('disables Apply until both ends of a range are set', () => {
        renderPicker();
        type('From', '2026-10-01');
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('offers time fields only for datetime columns', () => {
        renderPicker({ kind: 'date' });
        expect(screen.queryByLabelText('From time')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('To time')).not.toBeInTheDocument();
    });

    it('starts the time fields empty, with seconds', () => {
        renderPicker();
        expect(screen.getByLabelText('From time')).toHaveValue('');
        expect(screen.getByLabelText('From time')).toHaveAttribute('step', '1');
        expect(screen.getByLabelText('To time')).toHaveValue('');
    });

    it('applies a typed date with a time', () => {
        const { onApply } = renderPicker({ mode: 'single' });
        type('Date', '2026-10-01');
        type('Time', '14:00');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onApply).toHaveBeenCalledWith('2026-10-01 14:00:00', undefined);
    });

    it('fills the fields from the current value', () => {
        renderPicker({ value: '2026-10-01 14:00:00', to: '2026-10-15' });
        expect(screen.getByLabelText('From')).toHaveValue('2026-10-01');
        expect(screen.getByLabelText('From time')).toHaveValue('14:00:00');
        expect(screen.getByLabelText('To')).toHaveValue('2026-10-15');
    });

    it('rejects a typed time when times are off (on)', () => {
        const { onApply } = renderPicker({ mode: 'single', allowTime: false });
        expect(screen.queryByLabelText('Time')).not.toBeInTheDocument();
        type('Date', '2026-10-01 14:00');
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
        fireEvent.keyDown(screen.getByLabelText('Date'), { key: 'Enter' });
        expect(onApply).not.toHaveBeenCalled();
    });

    it('rejects a time on a date column', () => {
        renderPicker({ kind: 'date', mode: 'single' });
        type('Date', '2026-10-01 14:00');
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    });

    it('picks a day from the calendar', () => {
        const { onApply } = renderPicker({
            mode: 'single',
            value: '2026-10-01',
        });
        fireEvent.click(
            screen.getByRole('button', { name: /October 15th, 2026/ }),
        );
        expect(screen.getByLabelText('Date')).toHaveValue('2026-10-15');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onApply).toHaveBeenCalledWith('2026-10-15', undefined);
    });

    it('starts the week on Monday', () => {
        const { container } = render(
            <DatePicker
                kind="date"
                mode="single"
                value="2026-10-01"
                onApply={vi.fn()}
                onQuickRange={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        // The weekday row is aria-hidden; each day's own label names its weekday.
        const first = container.querySelector('th[scope="col"]');
        expect(first).toHaveAttribute('aria-label', 'Monday');
        expect(
            screen.getByRole('button', {
                name: /Monday, September 28th, 2026/,
            }),
        ).toBeInTheDocument();
    });

    it('applies a quick range at once', () => {
        const { onQuickRange } = renderPicker();
        fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
        const range = quickRanges(new Date())[2];
        expect(onQuickRange).toHaveBeenCalledWith(range.from, range.to);
    });

    it('cancels without applying', () => {
        const { onApply, onCancel } = renderPicker();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalled();
        expect(onApply).not.toHaveBeenCalled();
    });
});
