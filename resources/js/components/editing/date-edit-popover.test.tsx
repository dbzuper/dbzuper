import { fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { loadDatePicker } from '@/components/inspector/load-date-picker';
import { DateEditPopover } from './date-edit-popover';

const preloadDatePicker = vi.hoisted(() => vi.fn());
vi.mock('@/components/inspector/load-date-picker', async (orig) => ({
    ...(await orig<typeof import('@/components/inspector/load-date-picker')>()),
    preloadDatePicker,
}));

const renderPopover = () =>
    render(
        <DateEditPopover
            kind="date"
            value="2026-10-01"
            inputRef={createRef<HTMLInputElement>()}
            onApply={vi.fn()}
        />,
    );

describe('DateEditPopover', () => {
    it.each(['pointerEnter', 'focus'] as const)(
        'preloads the picker on %s of the calendar button',
        (event) => {
            renderPopover();
            preloadDatePicker.mockClear();
            fireEvent[event](
                screen.getByRole('button', { name: 'Choose date' }),
            );
            expect(preloadDatePicker).toHaveBeenCalled();
        },
    );

    it('opens a preloaded picker without a loading spinner', async () => {
        await loadDatePicker();
        renderPopover();
        fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
        const dialog = screen.getByRole('dialog');
        expect(
            within(dialog).queryByRole('status', { name: 'Loading' }),
        ).toBeNull();
        expect(within(dialog).getByRole('grid')).toBeInTheDocument();
    });
});
