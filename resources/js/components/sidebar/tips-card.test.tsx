import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TIPS_STORAGE_KEY, TipsCard } from '@/components/sidebar/tips-card';
import { SidebarProvider } from '@/components/ui/sidebar';

function renderTips(open = true) {
    return render(
        <SidebarProvider defaultOpen={open}>
            <TipsCard />
        </SidebarProvider>,
    );
}

const tipText = () => screen.getByTestId('tip-text');

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('TipsCard', () => {
    it('shows the first tip with its keys as kbd elements', () => {
        renderTips();
        expect(tipText()).toHaveTextContent(
            'Inside a workspace, press Ctrl K to jump to any table, column or saved query.',
        );
        const keys = [...tipText().querySelectorAll('kbd')].map(
            (k) => k.textContent,
        );
        expect(keys).toEqual(['Ctrl', 'K']);
    });

    it('separates from the sidebar with a token border (Graphite has no panel shadow and a sidebar-coloured background)', () => {
        renderTips();
        expect(screen.getByRole('region', { name: 'Tip' })).toHaveClass(
            'border',
            'border-sidebar-border',
        );
    });

    it('moves on with next and back with previous, wrapping around', () => {
        renderTips();
        fireEvent.click(screen.getByRole('button', { name: 'Next tip' }));
        expect(tipText()).toHaveTextContent(
            'Press Ctrl J to open the SQL panel.',
        );
        fireEvent.click(screen.getByRole('button', { name: 'Previous tip' }));
        fireEvent.click(screen.getByRole('button', { name: 'Previous tip' }));
        expect(tipText()).toHaveTextContent(
            'Double-click a table to keep its tab open; a single click previews it.',
        );
    });

    it('shows the remaining tips verbatim', () => {
        renderTips();
        fireEvent.click(screen.getByRole('button', { name: 'Tip 3 of 5' }));
        expect(tipText()).toHaveTextContent(
            'Alt + ↓ opens the date picker in a date filter or cell.',
        );
        fireEvent.click(screen.getByRole('button', { name: 'Tip 4 of 5' }));
        expect(tipText()).toHaveTextContent(
            'Press * on a table in the sidebar to pin it.',
        );
        expect(
            screen.getByRole('button', { name: 'Tip 4 of 5' }),
        ).toHaveAttribute('aria-current', 'true');
    });

    it('hides with ×, and stays hidden after a remount', () => {
        const first = renderTips();
        fireEvent.click(screen.getByRole('button', { name: 'Hide tips' }));
        expect(screen.queryByTestId('tip-text')).toBeNull();
        expect(
            JSON.parse(localStorage.getItem(TIPS_STORAGE_KEY)!),
        ).toMatchObject({
            hidden: true,
        });
        first.unmount();
        renderTips();
        expect(screen.queryByTestId('tip-text')).toBeNull();
    });

    it('remembers the tip it was on', () => {
        const first = renderTips();
        fireEvent.click(screen.getByRole('button', { name: 'Next tip' }));
        expect(JSON.parse(localStorage.getItem(TIPS_STORAGE_KEY)!)).toEqual({
            index: 1,
            hidden: false,
        });
        first.unmount();
        renderTips();
        expect(tipText()).toHaveTextContent(
            'Press Ctrl J to open the SQL panel.',
        );
    });

    it('ignores unreadable or out-of-range storage', () => {
        localStorage.setItem(TIPS_STORAGE_KEY, '{not json');
        const first = renderTips();
        expect(tipText()).toHaveTextContent('Inside a workspace');
        first.unmount();
        localStorage.setItem(
            TIPS_STORAGE_KEY,
            JSON.stringify({ index: 99, hidden: 'x' }),
        );
        renderTips();
        expect(tipText()).toHaveTextContent('Inside a workspace');
    });

    it('is not rendered while the sidebar is collapsed to icons', () => {
        renderTips(false);
        expect(screen.queryByTestId('tip-text')).toBeNull();
    });
});
