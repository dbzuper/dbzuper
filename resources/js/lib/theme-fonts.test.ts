import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadThemeFonts } from '@/lib/theme-fonts';

// Vitest does not process CSS, so a `?url` import comes back empty; stand in for the URL Vite emits.
vi.mock('../../css/fonts-graphite.css?url', () => ({
    default: '/build/assets/fonts-graphite-x1.css',
}));

const links = () =>
    document.head.querySelectorAll('link[data-theme-fonts="graphite"]');

afterEach(() => {
    document.head.querySelectorAll('link').forEach((link) => link.remove());
});

describe('loadThemeFonts', () => {
    it('adds the Graphite font stylesheet once, however often it is asked', () => {
        loadThemeFonts('graphite');
        loadThemeFonts('graphite');

        expect(links()).toHaveLength(1);
        const link = links()[0] as HTMLLinkElement;

        expect(link.rel).toBe('stylesheet');
        expect(link.getAttribute('href')).toBe(
            '/build/assets/fonts-graphite-x1.css',
        );
    });

    it('adds nothing when Blade already linked the stylesheet on first paint', () => {
        const blade = document.createElement('link');
        blade.rel = 'stylesheet';
        blade.href = '/build/assets/fonts-graphite-abc123.css';
        document.head.append(blade);

        loadThemeFonts('graphite');

        expect(document.head.querySelectorAll('link')).toHaveLength(1);
    });

    it.each(['classic', 'layered'] as const)(
        'loads nothing for %s',
        (theme) => {
            loadThemeFonts(theme);

            expect(document.head.querySelectorAll('link')).toHaveLength(0);
        },
    );

    it('points at a stylesheet that imports both Graphite fonts', () => {
        const css = readFileSync('resources/css/fonts-graphite.css', 'utf8');

        expect(css).toContain('@fontsource-variable/schibsted-grotesk');
        expect(css).toContain('@fontsource-variable/jetbrains-mono');
    });
});
