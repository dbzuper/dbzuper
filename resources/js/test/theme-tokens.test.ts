import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('resources/css/app.css', 'utf8');

/** The declarations of every top-level rule that has exactly this selector. */
function declarations(selector: string): string {
    const bodies: string[] = [];
    let from = 0;

    for (;;) {
        const at = css.indexOf(`\n${selector} {`, from);

        if (at === -1) {
            break;
        }

        const open = css.indexOf('{', at);
        const close = css.indexOf('}', open);

        bodies.push(css.slice(open + 1, close));
        from = close;
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

    it('has a reduced-motion rule', () => {
        expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    });
});
