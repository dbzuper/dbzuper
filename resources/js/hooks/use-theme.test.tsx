import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
    DEFAULT_THEME,
    initializeColorTheme,
    parseTheme,
    THEMES,
    useColorTheme,
} from '@/hooks/use-theme';

afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.cookie = 'theme=;path=/;max-age=0';
});

describe('parseTheme', () => {
    it.each(['neon', '', undefined, null, 42])(
        'falls back to classic for %s',
        (value) => {
            expect(parseTheme(value)).toBe('classic');
        },
    );

    it.each(['classic', 'layered', 'graphite'])('accepts %s', (value) => {
        expect(parseTheme(value)).toBe(value);
    });
});

describe('THEMES', () => {
    it('lists the three themes with labels, Classic by default', () => {
        expect(THEMES).toEqual([
            { name: 'classic', label: 'Classic' },
            { name: 'layered', label: 'Layered' },
            { name: 'graphite', label: 'Graphite' },
        ]);
        expect(DEFAULT_THEME).toBe('classic');
    });
});

describe('useColorTheme', () => {
    it('applies, stores and publishes a new theme', () => {
        const { result } = renderHook(() => useColorTheme());

        act(() => result.current.updateTheme('layered'));

        expect(document.documentElement.dataset.theme).toBe('layered');
        expect(localStorage.getItem('theme')).toBe('layered');
        expect(document.cookie).toContain('theme=layered');
        expect(result.current.theme).toBe('layered');
    });
});

describe('initializeColorTheme', () => {
    it('applies the stored theme', () => {
        localStorage.setItem('theme', 'graphite');

        initializeColorTheme();

        expect(document.documentElement.dataset.theme).toBe('graphite');
    });

    it('ignores an unknown stored theme', () => {
        localStorage.setItem('theme', 'neon');

        initializeColorTheme();

        expect(document.documentElement.dataset.theme).toBe('classic');
    });
});
