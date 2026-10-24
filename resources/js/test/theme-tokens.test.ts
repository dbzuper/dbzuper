import { describe, expect, it } from 'vitest';
import {
    css,
    declarations,
    properties,
    SHELL_TOKENS,
    THEMES,
    token,
} from './css-tokens';

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

    it('maps the colour utilities inline, so a nested data-theme swatch draws its own colours', () => {
        // A plain @theme declares `--color-x: var(--x)` once on :root, where var() resolves to the page
        // theme's value and is inherited as such; `bg-primary` inside `[data-theme='layered']` would then
        // still paint the page theme. Inline, the utility reads `var(--x)` on the element itself.
        const inline = /^@theme inline \{([^}]*)\}/m.exec(css);

        expect(inline).not.toBeNull();
        const colours = [...css.matchAll(/^\s*(--color-[\w-]+):/gm)].map(
            (m) => m[1],
        );

        expect(colours.length).toBeGreaterThan(0);
        expect(properties(inline![1])).toEqual(colours);
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

        it('defines every custom property Classic dark defines, and the shell tokens', () => {
            const defined = properties(themeDark);

            expect(
                [...properties(dark), ...SHELL_TOKENS].filter(
                    (p) => !defined.includes(p),
                ),
            ).toEqual([]);
        });

        it.each([
            ['light', theme.light],
            ['dark', theme.dark],
        ])(
            `keeps the ${theme.shell} shell look in %s mode`,
            (_mode, selector) => {
                const body = declarations(selector);

                if (theme.shell === 'flat') {
                    // Classic's edge-to-edge panels.
                    expect(token(body, '--shell')).toBe('var(--background)');
                    expect(token(body, '--shell-gap')).toBe('0px');
                    expect(token(body, '--panel-radius')).toBe('0px');
                    expect(token(body, '--panel-shadow')).toBe('0 0 #0000');
                    expect(token(body, '--chrome-edge')).toBe('var(--border)');
                } else {
                    // Panels lifted off a canvas: 8px gap, 12px radius, a shadow. The sidebar stays flat on
                    // the canvas (version A): no edge and no shadow.
                    expect(token(body, '--chrome-edge')).toBe('transparent');
                    expect(token(body, '--sidebar-shadow')).toBe('0 0 #0000');
                    expect(token(body, '--shell')).not.toBe(
                        'var(--background)',
                    );
                    expect(token(body, '--shell-gap')).toBe('8px');
                    expect(token(body, '--panel-radius')).toBe('12px');
                    expect(token(body, '--panel-shadow')).not.toBe('0 0 #0000');
                }
            },
        );

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

    it('gives Graphite its own fonts as plain custom properties that @theme reads', () => {
        const body = declarations("[data-theme='graphite']");

        expect(token(body, '--font-sans')).toBe(
            "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, sans-serif",
        );
        expect(token(body, '--font-mono')).toBe(
            "'JetBrains Mono Variable', ui-monospace, monospace",
        );
        // A plain (not inline) @theme emits --font-* as variables, so the theme block can override them.
        expect(css).toMatch(/^@theme \{/m);
    });

    it('has a reduced-motion rule', () => {
        expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    });

    it('draws thin scrollbars from theme tokens, with no track', () => {
        expect(css).toContain('scrollbar-width: thin;');
        expect(css.replace(/\s+/g, ' ')).toMatch(
            /scrollbar-color: color-mix\( ?in oklab, var\(--muted-foreground\) \d+%, transparent ?\) transparent;/,
        );
    });
});
