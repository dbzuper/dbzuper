import { describe, expect, it } from 'vitest';
import { css, declarations, properties, THEMES, token } from './css-tokens';

describe('theme tokens', () => {
    const light = declarations(':root');
    const dark = declarations('.dark');

    it('defines --warning in both themes and exposes it to Tailwind', () => {
        expect(token(light, '--warning')).toBeTruthy();
        expect(token(dark, '--warning')).toBeTruthy();
        expect(css).toContain('--color-warning: var(--warning)');
    });

    it.each(['--primary', '--ring', '--background', '--card'])(
        'tints %s differently per theme',
        (name) => {
            expect(token(light, name)).toBeTruthy();
            expect(token(dark, name)).toBeTruthy();
            expect(token(light, name)).not.toBe(token(dark, name));
        },
    );

    it('matches a selector inside a selector list', () => {
        expect(light).not.toBe('');
        expect(dark).not.toBe('');
    });

    it('lets a nested Classic swatch show Classic inside another theme', () => {
        expect(declarations("[data-theme='classic']")).toBe(light);
        expect(declarations(".dark [data-theme='classic']")).toBe(dark);
    });

    it('defines the shell tokens with Classic values and exposes --shell to Tailwind', () => {
        expect(token(light, '--shell')).toBe('var(--background)');
        expect(token(light, '--shell-gap')).toBe('0px');
        expect(token(light, '--panel-radius')).toBe('0px');
        expect(token(light, '--panel-shadow')).toBe('0 0 #0000');
        expect(css).toContain('--color-shell: var(--shell)');
    });

    it('drops the shell gap and radius on narrow screens, as the last rule', () => {
        const narrow = '@media (width < 48rem) {';
        const at = css.lastIndexOf(narrow);

        expect(at).toBeGreaterThan(-1);
        const tail = css.slice(at);

        expect(tail).toMatch(
            /:root\[data-theme\],\s*:root\[data-theme\]\.dark \{/,
        );
        expect(token(tail, '--shell-gap')).toBe('0px');
        expect(token(tail, '--panel-radius')).toBe('0px');
        // Nothing follows the media block: its inner rule closes, then the block does.
        const inner = tail.indexOf('}');

        expect(tail.indexOf('}', inner + 1)).toBe(tail.trimEnd().length - 1);
    });

    describe.each(THEMES)('$name', (theme) => {
        const themeLight = declarations(theme.light);
        const themeDark = declarations(theme.dark);

        it('defines every custom property Classic light defines', () => {
            const defined = properties(themeLight);

            expect(
                properties(light).filter((p) => !defined.includes(p)),
            ).toEqual([]);
        });

        it('defines every custom property Classic dark defines', () => {
            const defined = properties(themeDark);

            expect(
                properties(dark).filter((p) => !defined.includes(p)),
            ).toEqual([]);
        });

        it('lets a nested swatch show the dark variant inside a dark page', () => {
            expect(declarations(theme.nestedDark)).toBe(themeDark);
        });

        it('comes after the Classic blocks', () => {
            const lastClassic = css.lastIndexOf(".dark [data-theme='classic']");

            expect(css.indexOf(`${theme.light} {`)).toBeGreaterThan(
                lastClassic,
            );
            expect(css.indexOf(`${theme.dark},`)).toBeGreaterThan(lastClassic);
        });
    });

    it('lifts Layered panels off a canvas: 8px gap, 12px radius, a shadow in both modes', () => {
        for (const selector of [
            "[data-theme='layered']",
            "[data-theme='layered'].dark",
        ]) {
            const body = declarations(selector);

            expect(token(body, '--shell')).not.toBe('var(--background)');
            expect(token(body, '--shell-gap')).toBe('8px');
            expect(token(body, '--panel-radius')).toBe('12px');
            expect(token(body, '--panel-shadow')).not.toBe('0 0 #0000');
        }
    });

    it('has a reduced-motion rule', () => {
        expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    });
});
