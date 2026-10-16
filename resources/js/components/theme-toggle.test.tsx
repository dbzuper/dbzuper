import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTheme } from '@/hooks/use-appearance';
import { ThemeToggle } from './theme-toggle';

function mockMatchMedia(dark: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: dark,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    mockMatchMedia(true);
});

describe('ThemeToggle', () => {
    it('defaults to dark and labels the next state', () => {
        initializeTheme();
        render(<ThemeToggle />);
        expect(document.documentElement).toHaveClass('dark');
        expect(
            screen.getByRole('button', {
                name: 'Theme: dark (switch to light)',
            }),
        ).toBeInTheDocument();
    });

    it('cycles dark, light, system and persists the choice', () => {
        initializeTheme();
        render(<ThemeToggle />);

        fireEvent.click(screen.getByRole('button'));
        expect(document.documentElement).not.toHaveClass('dark');
        expect(localStorage.getItem('appearance')).toBe('light');
        expect(
            screen.getByRole('button', {
                name: 'Theme: light (switch to system)',
            }),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button'));
        expect(localStorage.getItem('appearance')).toBe('system');
        expect(
            screen.getByRole('button', {
                name: 'Theme: system (switch to dark)',
            }),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button'));
        expect(localStorage.getItem('appearance')).toBe('dark');
        expect(document.documentElement).toHaveClass('dark');
    });

    it('follows a light system preference under system', () => {
        mockMatchMedia(false);
        localStorage.setItem('appearance', 'system');
        initializeTheme();
        render(<ThemeToggle />);
        expect(document.documentElement).not.toHaveClass('dark');
    });
});
