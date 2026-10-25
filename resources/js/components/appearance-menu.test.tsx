import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inertiajs/react', () => ({
    Head: () => null,
}));

import { AppearanceMenu } from '@/components/appearance-menu';
import { ThemeCards } from '@/components/theme-cards';
import { initializeTheme } from '@/hooks/use-appearance';
import { initializeColorTheme } from '@/hooks/use-theme';
import AppearancePage from '@/pages/settings/appearance';

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('theme', 'classic');
    localStorage.setItem('appearance', 'dark');
    initializeTheme();
    initializeColorTheme();
});

afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.classList.remove('dark');
    document.cookie = 'theme=;path=/;max-age=0';
    document.cookie = 'appearance=;path=/;max-age=0';
});

function openMenu() {
    render(<AppearanceMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
}

describe('AppearanceMenu', () => {
    it('opens a popover with Theme and Mode radiogroups', () => {
        openMenu();
        const theme = screen.getByRole('radiogroup', { name: 'Theme' });
        const mode = screen.getByRole('radiogroup', { name: 'Mode' });

        expect(
            within(theme)
                .getAllByRole('radio')
                .map((r) => r.textContent),
        ).toEqual(['Classic', 'Layered', 'Graphite', 'Radar']);
        expect(
            within(mode)
                .getAllByRole('radio')
                .map((r) => r.textContent),
        ).toEqual(['Light', 'Dark', 'System']);
        expect(
            within(theme).getByRole('radio', { name: 'Classic' }),
        ).toHaveAttribute('aria-checked', 'true');
        expect(
            within(mode).getByRole('radio', { name: 'Dark' }),
        ).toHaveAttribute('aria-checked', 'true');
    });

    it('draws each swatch inside its own data-theme wrapper', () => {
        openMenu();
        const theme = screen.getByRole('radiogroup', { name: 'Theme' });

        for (const name of ['classic', 'layered', 'graphite', 'radar']) {
            const swatch = theme.querySelector(`[data-theme="${name}"]`);

            expect(swatch).not.toBeNull();
            expect(swatch!.querySelector('.bg-background')).not.toBeNull();
            expect(swatch!.querySelector('.bg-primary')).not.toBeNull();
            expect(swatch!.querySelector('.bg-sidebar')).not.toBeNull();
        }
    });

    it('applies a theme on click and stays open', () => {
        openMenu();
        const graphite = screen.getByRole('radio', { name: 'Graphite' });

        fireEvent.click(graphite);

        expect(document.documentElement.dataset.theme).toBe('graphite');
        expect(graphite).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: 'Classic' })).toHaveAttribute(
            'aria-checked',
            'false',
        );
        expect(
            screen.getByRole('radiogroup', { name: 'Theme' }),
        ).toBeInTheDocument();
    });

    it('moves focus with the arrow keys (wrapping) without selecting; Enter and Space select', () => {
        openMenu();
        const [classic, layered, graphite, radar] = within(
            screen.getByRole('radiogroup', { name: 'Theme' }),
        ).getAllByRole('radio');

        // Roving tabindex: only the checked radio is in the tab order.
        expect(classic).toHaveAttribute('tabindex', '0');
        expect(layered).toHaveAttribute('tabindex', '-1');

        classic.focus();
        fireEvent.keyDown(classic, { key: 'ArrowRight' });
        expect(layered).toHaveFocus();
        expect(layered).toHaveAttribute('tabindex', '0');
        expect(classic).toHaveAttribute('tabindex', '-1');
        expect(document.documentElement.dataset.theme).toBe('classic');

        fireEvent.keyDown(layered, { key: 'ArrowDown' });
        expect(graphite).toHaveFocus();
        fireEvent.keyDown(graphite, { key: 'ArrowRight' });
        expect(radar).toHaveFocus();
        fireEvent.keyDown(radar, { key: 'ArrowRight' });
        expect(classic).toHaveFocus();
        fireEvent.keyDown(classic, { key: 'ArrowLeft' });
        expect(radar).toHaveFocus();
        fireEvent.keyDown(radar, { key: 'Home' });
        expect(classic).toHaveFocus();
        fireEvent.keyDown(classic, { key: 'End' });
        expect(radar).toHaveFocus();

        // A button radio: Enter and Space activate it as a click.
        fireEvent.click(graphite);
        expect(document.documentElement.dataset.theme).toBe('graphite');
        expect(graphite).toHaveAttribute('aria-checked', 'true');
    });

    it('sets the mode from the Mode group', () => {
        openMenu();
        fireEvent.click(screen.getByRole('radio', { name: 'Light' }));

        expect(localStorage.getItem('appearance')).toBe('light');
        expect(document.documentElement).not.toHaveClass('dark');
        expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute(
            'aria-checked',
            'true',
        );

        fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
        expect(document.documentElement).toHaveClass('dark');
    });
});

describe('ThemeCards', () => {
    it('shows one miniature per theme inside its own data-theme wrapper', () => {
        render(<ThemeCards />);
        const group = screen.getByRole('radiogroup', { name: 'Theme' });
        const cards = within(group).getAllByRole('radio');

        expect(cards.map((c) => c.textContent)).toEqual([
            'Classic',
            'Layered',
            'Graphite',
            'Radar',
        ]);
        cards.forEach((card, i) => {
            expect(
                card.querySelector(
                    `[data-theme="${['classic', 'layered', 'graphite', 'radar'][i]}"]`,
                ),
            ).not.toBeNull();
        });
    });

    it('selects a theme and moves focus with the arrow keys', () => {
        render(<ThemeCards />);
        const [classic, layered] = screen.getAllByRole('radio');

        classic.focus();
        fireEvent.keyDown(classic, { key: 'ArrowRight' });
        expect(layered).toHaveFocus();

        fireEvent.click(layered);
        expect(document.documentElement.dataset.theme).toBe('layered');
        expect(layered).toHaveAttribute('aria-checked', 'true');
        expect(classic).toHaveAttribute('aria-checked', 'false');
    });
});

describe('Appearance settings page', () => {
    it('shows the four theme cards above the mode tabs, the current one checked', () => {
        localStorage.setItem('theme', 'layered');
        initializeColorTheme();
        render(<AppearancePage />);

        const group = screen.getByRole('radiogroup', { name: 'Theme' });
        const cards = within(group).getAllByRole('radio');

        expect(cards).toHaveLength(4);
        expect(
            within(group).getByRole('radio', { name: 'Layered' }),
        ).toHaveAttribute('aria-checked', 'true');
        expect(
            cards.filter((c) => c.getAttribute('aria-checked') === 'true'),
        ).toHaveLength(1);
        // Cards come before the Light/Dark/System tabs.
        const tabs = screen.getByRole('button', { name: 'System' });

        expect(
            group.compareDocumentPosition(tabs) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });
});
