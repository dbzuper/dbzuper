import { useSyncExternalStore } from 'react';
import { loadThemeFonts } from '@/lib/theme-fonts';

export type ThemeName = 'classic' | 'layered' | 'graphite';

export const THEMES: readonly { name: ThemeName; label: string }[] = [
    { name: 'classic', label: 'Classic' },
    { name: 'layered', label: 'Layered' },
    { name: 'graphite', label: 'Graphite' },
];

export const DEFAULT_THEME: ThemeName = 'classic';

/** A known theme name, or Classic for anything else (a stale cookie, a typo, nothing). */
export const parseTheme = (v: unknown): ThemeName =>
    THEMES.some((t) => t.name === v) ? (v as ThemeName) : DEFAULT_THEME;

const listeners = new Set<() => void>();

let currentTheme: ThemeName = DEFAULT_THEME;

const setCookie = (name: string, value: string, days = 365): void => {
    if (typeof document === 'undefined') {
        return;
    }

    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${value};path=/;max-age=${maxAge};SameSite=Lax`;
};

const applyColorTheme = (theme: ThemeName): void => {
    if (typeof document === 'undefined') {
        return;
    }

    document.documentElement.dataset.theme = theme;

    if (theme === 'graphite') {
        loadThemeFonts(theme);
    }
};

const subscribe = (callback: () => void) => {
    listeners.add(callback);

    return () => listeners.delete(callback);
};

const notify = (): void => listeners.forEach((listener) => listener());

export function initializeColorTheme(): void {
    if (typeof window === 'undefined') {
        return;
    }

    const stored = localStorage.getItem('theme');

    if (parseTheme(stored) === stored) {
        currentTheme = stored as ThemeName;
    } else {
        // Nothing usable stored: keep the theme the server rendered from the cookie, so the page does
        // not flash to Classic, and store it so both sides agree from now on.
        currentTheme = parseTheme(document.documentElement.dataset.theme);
        localStorage.setItem('theme', currentTheme);
        setCookie('theme', currentTheme);
    }

    applyColorTheme(currentTheme);
}

export function useColorTheme(): {
    theme: ThemeName;
    updateTheme(t: ThemeName): void;
} {
    const theme = useSyncExternalStore(
        subscribe,
        () => currentTheme,
        () => DEFAULT_THEME,
    );

    const updateTheme = (t: ThemeName): void => {
        currentTheme = t;

        // Store in localStorage for client-side persistence...
        localStorage.setItem('theme', t);

        // Store in cookie for SSR...
        setCookie('theme', t);

        applyColorTheme(t);
        notify();
    };

    return { theme, updateTheme } as const;
}
