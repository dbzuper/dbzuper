import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { quickRanges } from '@/lib/date-filter';
import DatePicker, { EditDatePicker } from './date-picker';

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

    it('says on means a whole day when a time is typed for on', () => {
        renderPicker({ mode: 'single', allowTime: false });
        type('Date', '2026-10-01 14:00');
        expect(screen.getByRole('alert')).toHaveTextContent(
            '“on” means a whole day — enter a date without a time',
        );
    });

    it('keeps the format hint for text that is not a date under on', () => {
        renderPicker({ mode: 'single', allowTime: false });
        type('Date', '2026-10-1x');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Use YYYY-MM-DD or YYYY-MM-DD HH:MM:SS',
        );
    });

    it('refuses 9999-12-31 where the filter needs the day after', () => {
        const { onApply } = renderPicker({
            mode: 'single',
            allowTime: false,
            needsNextDay: true,
        });
        type('Date', '9999-12-31');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'That date is too late to filter by',
        );
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
        fireEvent.keyDown(screen.getByLabelText('Date'), { key: 'Enter' });
        expect(onApply).not.toHaveBeenCalled();
    });

    it('takes 9999-12-31 where no day after is needed (before, equals)', () => {
        const { onApply } = renderPicker({ mode: 'single' });
        type('Date', '9999-12-31');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onApply).toHaveBeenCalledWith('9999-12-31', undefined);
    });

    it('takes a timed value on 9999-12-31 where the day after is needed', () => {
        const { onApply } = renderPicker({
            mode: 'single',
            needsNextDay: true,
        });
        type('Date', '9999-12-31');
        type('Time', '10:00');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onApply).toHaveBeenCalledWith('9999-12-31 10:00:00', undefined);
    });

    it('refuses a date-only range end of 9999-12-31, typed in either field', () => {
        const { onApply } = renderPicker({ needsNextDay: true });
        type('From', '2026-10-01');
        type('To', '9999-12-31');
        expect(screen.getByRole('alert')).toHaveTextContent(
            'That date is too late to filter by',
        );
        expect(screen.getByLabelText('To')).toHaveAttribute(
            'aria-invalid',
            'true',
        );
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
        // Reversed, the From field holds the end.
        type('From', '9999-12-31');
        type('To', '2026-10-01');
        expect(screen.getByLabelText('From')).toHaveAttribute(
            'aria-invalid',
            'true',
        );
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
        // A timed end on that day is fine.
        type('To', '9999-12-31');
        type('To time', '23:00');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onApply).toHaveBeenCalledWith(
            '9999-12-31',
            '9999-12-31 23:00:00',
        );
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
            screen.getByRole('button', { name: /^15 October 2026/ }),
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
        // The weekday header names the weekday; a day button's label names only the date.
        const first = container.querySelector('th[scope="col"]');
        expect(first).toHaveAttribute('aria-label', 'Monday');
        expect(
            screen.getByRole('button', {
                name: /^28 September 2026/,
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

describe('EditDatePicker', () => {
    function renderEdit(
        props: Partial<Parameters<typeof EditDatePicker>[0]> = {},
    ) {
        const handlers = { onApply: vi.fn(), onCancel: vi.fn() };
        render(
            <EditDatePicker
                kind="datetime"
                value={null}
                {...handlers}
                {...props}
            />,
        );
        return handlers;
    }
    const apply = () =>
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    afterEach(() => vi.useRealTimers());

    it('offers no quick ranges', () => {
        renderEdit();
        expect(
            screen.queryByRole('list', { name: 'Quick ranges' }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Last 7 days' }),
        ).not.toBeInTheDocument();
    });

    it('fills the date and time from the value', () => {
        renderEdit({ value: '2026-10-01 12:30:45' });
        expect(screen.getByLabelText('Date')).toHaveValue('2026-10-01');
        expect(screen.getByLabelText('Time')).toHaveValue('12:30:45');
        expect(screen.getByLabelText('Time')).toHaveAttribute('step', '1');
        expect(
            screen.getByRole('button', { name: /^1 October 2026.*selected/ }),
        ).toBeInTheDocument();
    });

    it.each([null, '', '0000-00-00 00:00:00', 'not a date', '2026-02-30'])(
        'opens empty, without an error, for %j',
        (value) => {
            renderEdit({ value });
            expect(screen.getByLabelText('Date')).toHaveValue('');
            expect(screen.getByLabelText('Time')).toHaveValue('');
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(
                screen.getByRole('button', { name: 'Apply' }),
            ).toBeDisabled();
        },
    );

    it('sets the local date and time to the second with Now', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 9, 24, 13, 5, 9, 600));
        const { onApply } = renderEdit({ value: '2026-10-01 12:00:00' });
        expect(
            screen.queryByRole('button', { name: 'Today' }),
        ).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Now' }));
        expect(screen.getByLabelText('Date')).toHaveValue('2026-10-24');
        expect(screen.getByLabelText('Time')).toHaveValue('13:05:09');
        apply();
        expect(onApply).toHaveBeenCalledWith('2026-10-24 13:05:09');
    });

    it('sets today with Today on a date column, with no time field', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 9, 24, 13, 5, 9));
        const { onApply } = renderEdit({ kind: 'date', value: '2026-10-01' });
        expect(screen.queryByLabelText('Time')).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Now' }),
        ).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Today' }));
        apply();
        expect(onApply).toHaveBeenCalledWith('2026-10-24');
    });

    it('picks a day and keeps the time', () => {
        const { onApply } = renderEdit({ value: '2026-10-01 12:00:00' });
        fireEvent.click(
            screen.getByRole('button', { name: /^15 October 2026/ }),
        );
        apply();
        expect(onApply).toHaveBeenCalledWith('2026-10-15 12:00:00');
    });

    it.each([
        ['2026-10-01 12:00:00+08', '2026-10-15 12:00:00+08'],
        ['2026-10-01 12:00:00+0800', '2026-10-15 12:00:00+0800'],
        ['2026-10-01 12:00:00+08:00', '2026-10-15 12:00:00+08:00'],
        ['2026-10-01 12:00:00-05:30', '2026-10-15 12:00:00-05:30'],
        ['2026-10-01T12:00:00Z', '2026-10-15 12:00:00Z'],
    ])('keeps the zone suffix of %s verbatim', (value, applied) => {
        const { onApply } = renderEdit({ value });
        expect(screen.getByLabelText('Date')).toHaveValue('2026-10-01');
        expect(screen.getByLabelText('Time')).toHaveValue('12:00:00');
        fireEvent.click(
            screen.getByRole('button', { name: /^15 October 2026/ }),
        );
        apply();
        expect(onApply).toHaveBeenCalledWith(applied);
    });

    it('keeps fractional seconds (and the zone) when only the day changes', () => {
        const { onApply } = renderEdit({
            value: '2026-10-01 12:00:00.123456+00',
        });
        fireEvent.click(
            screen.getByRole('button', { name: /^15 October 2026/ }),
        );
        apply();
        expect(onApply).toHaveBeenCalledWith('2026-10-15 12:00:00.123456+00');
    });

    it('adds no suffix to a value without one', () => {
        const { onApply } = renderEdit({ kind: 'date', value: '2026-10-01' });
        fireEvent.click(
            screen.getByRole('button', { name: /^15 October 2026/ }),
        );
        apply();
        expect(onApply).toHaveBeenCalledWith('2026-10-15');
    });

    it('validates typed text inline and disables Apply', () => {
        renderEdit({ kind: 'date', value: '2026-10-01' });
        type('Date', '2026-10-01 10:00');
        expect(screen.getByRole('alert')).toHaveTextContent('YYYY-MM-DD');
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    });

    it('takes 9999-12-31', () => {
        const { onApply } = renderEdit({ kind: 'date' });
        type('Date', '9999-12-31');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        apply();
        expect(onApply).toHaveBeenCalledWith('9999-12-31');
    });

    it.each([
        ['2026-10-01 12:00:00+00', '2026-10-23 07:00:00+00'],
        ['2026-10-01 12:00:00Z', '2026-10-23 07:00:00Z'],
        ['2026-10-01 12:00:00+08:00', '2026-10-23 15:00:00+08:00'],
        ['2026-10-01 12:00:00+0800', '2026-10-23 15:00:00+0800'],
        ['2026-10-01 12:00:00-05:30', '2026-10-23 01:30:00-05:30'],
    ])('sets Now as the current moment in the zone of %s', (value, applied) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // An instant: the result must not depend on the runner's time zone.
        vi.setSystemTime(new Date('2026-10-23T07:00:00Z'));
        const { onApply } = renderEdit({ value });
        fireEvent.click(screen.getByRole('button', { name: 'Now' }));
        apply();
        expect(onApply).toHaveBeenCalledWith(applied);
    });

    it('gives a date-only value midnight before a kept zone, never a bare date with a zone', () => {
        const { onApply } = renderEdit({ value: '2026-10-01 12:00:00+08' });
        type('Date', '2026-10-15');
        fireEvent.change(screen.getByLabelText('Time'), {
            target: { value: '' },
        });
        apply();
        expect(onApply).toHaveBeenCalledWith('2026-10-15 00:00:00+08');
    });

    it('drops the zone on a date column', () => {
        const { onApply } = renderEdit({
            kind: 'date',
            value: '2026-10-01 12:00:00+08',
        });
        type('Date', '2026-10-15');
        apply();
        expect(onApply).toHaveBeenCalledWith('2026-10-15');
    });

    it('replaces junk after the date with the picked day', () => {
        const { onApply } = renderEdit();
        type('Date', '2026-10-01xyz');
        expect(screen.getByRole('alert')).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole('button', { name: /^15 October 2026/ }),
        );
        expect(screen.getByLabelText('Date')).toHaveValue('2026-10-15');
        apply();
        expect(onApply).toHaveBeenCalledWith('2026-10-15');
    });

    it('cancels without applying', () => {
        const { onApply, onCancel } = renderEdit();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalled();
        expect(onApply).not.toHaveBeenCalled();
    });
});
