import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchThemeChanges } from '@/lib/theme-watch';

const root = document.documentElement;

afterEach(() => {
    delete root.dataset.theme;
    root.classList.remove('dark');
});

/** MutationObserver callbacks run as microtasks. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('watchThemeChanges', () => {
    it('fires when data-theme changes', async () => {
        const cb = vi.fn();
        const stop = watchThemeChanges(cb);

        root.dataset.theme = 'layered';
        await flush();

        expect(cb).toHaveBeenCalled();
        stop();
    });

    it('fires when the dark class changes', async () => {
        const cb = vi.fn();
        const stop = watchThemeChanges(cb);

        root.classList.add('dark');
        await flush();

        expect(cb).toHaveBeenCalled();
        stop();
    });

    it('ignores other attributes and stops when disposed', async () => {
        const cb = vi.fn();
        const stop = watchThemeChanges(cb);

        root.setAttribute('lang', 'fr');
        await flush();
        expect(cb).not.toHaveBeenCalled();

        stop();
        root.dataset.theme = 'graphite';
        await flush();
        expect(cb).not.toHaveBeenCalled();
        root.setAttribute('lang', 'en');
    });
});
