import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSqlTabs } from '@/sql/tabs-store';
import { SqlTabsBar } from './sql-tabs-bar';

const CONNECTION = '7';
const state = () => useSqlTabs.getState().byConnection[CONNECTION];

describe('SqlTabsBar', () => {
    beforeEach(() => {
        useSqlTabs.setState({ byConnection: {} });
        useSqlTabs.getState().ensure(CONNECTION);
        useSqlTabs.getState().openTab(CONNECTION, 'select 2', 'Second');
        useSqlTabs.getState().openTab(CONNECTION, 'select 3', 'Third');
        useSqlTabs.getState().setActive(CONNECTION, state().tabs[0].id);
    });

    it('owns only tabs: the tablist wraps them and the close buttons are hidden mouse affordances', () => {
        render(<SqlTabsBar connectionId={CONNECTION} />);
        const tablist = screen.getByRole('tablist', { name: 'SQL tabs' });
        expect(screen.getAllByRole('tab')).toHaveLength(3);
        for (const tab of screen.getAllByRole('tab'))
            expect(tablist).toContainElement(tab);
        const hidden = tablist.querySelectorAll('button[aria-hidden="true"]');
        expect(hidden).toHaveLength(3);
        for (const b of hidden) {
            expect(b).toHaveAttribute('tabindex', '-1');
            // A tooltip for mouse users (and a name for voice control).
            expect(b).toHaveAttribute('title', 'Close');
        }
    });

    it('closes a focused tab with Delete or Backspace and focuses the tab that becomes active', async () => {
        render(<SqlTabsBar connectionId={CONNECTION} />);
        const [, second] = screen.getAllByRole('tab');
        fireEvent.click(second);
        second.focus();
        fireEvent.keyDown(second, { key: 'Delete' });
        expect(state().tabs.map((t) => t.title)).not.toContain('Second');
        await waitFor(() =>
            expect(screen.getByRole('tab', { selected: true })).toHaveFocus(),
        );

        const remaining = screen.getAllByRole('tab');
        fireEvent.keyDown(remaining[0], { key: 'Backspace' });
        expect(state().tabs).toHaveLength(1);
    });

    it('moves between tabs with the arrow keys, Home and End', () => {
        render(<SqlTabsBar connectionId={CONNECTION} />);
        const tabs = screen.getAllByRole('tab');
        tabs[0].focus();
        fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
        expect(tabs[1]).toHaveFocus();
        expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(tabs[1], { key: 'End' });
        expect(tabs[2]).toHaveFocus();
        fireEvent.keyDown(tabs[2], { key: 'ArrowRight' });
        expect(tabs[0]).toHaveFocus();
        fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
        expect(tabs[2]).toHaveFocus();
        fireEvent.keyDown(tabs[2], { key: 'Home' });
        expect(tabs[0]).toHaveFocus();
    });
});
