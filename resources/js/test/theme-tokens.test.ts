import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('resources/css/app.css', 'utf8');

/** The declarations of every top-level rule whose selector list contains this selector. */
function declarations(selector: string): string {
    const bodies: string[] = [];
    // A top-level rule starts at the beginning of a line; nested rules are indented.
    const rule = /^([^\s@}][^{]*)\{/gm;

    for (const match of css.matchAll(rule)) {
        const selectors = match[1].split(',').map((s) => s.trim());

        if (!selectors.includes(selector)) {
            continue;
        }

        const open = match.index + match[0].length - 1;
        const close = css.indexOf('}', open);

        bodies.push(css.slice(open + 1, close));
    }

    return bodies.join('\n');
}

function token(body: string, name: string): string | undefined {
    const line = body
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith(`${name}:`));

    return line?.slice(name.length + 1, -1).trim();
}

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

    it('has a reduced-motion rule', () => {
        expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    });
});
