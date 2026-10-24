import { readFileSync } from 'node:fs';

export const css = readFileSync('resources/css/app.css', 'utf8');

/** The declarations of every top-level rule whose selector list contains this selector. */
export function declarations(selector: string): string {
    const bodies: string[] = [];
    // A top-level rule starts at the beginning of a line; nested rules are indented.
    const rule = /^([^\s@}][^{]*)\{/gm;

    for (const match of css.matchAll(rule)) {
        // A comment just above a rule is part of the match; drop it.
        const selectors = match[1]
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split(',')
            .map((s) => s.trim());

        if (!selectors.includes(selector)) {
            continue;
        }

        const open = match.index + match[0].length - 1;
        const close = css.indexOf('}', open);

        bodies.push(css.slice(open + 1, close));
    }

    return bodies.join('\n');
}

/** The value of one custom property in a rule body. */
export function token(body: string, name: string): string | undefined {
    const line = body
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith(`${name}:`));

    return line?.slice(name.length + 1, -1).trim();
}

/** Every custom property name a rule body defines. */
export function properties(body: string): string[] {
    return [...body.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]);
}

/** The colour themes beyond Classic: each one's light and dark selector. Later themes add a row. */
export const THEMES = [
    {
        name: 'layered',
        light: "[data-theme='layered']",
        dark: "[data-theme='layered'].dark",
        nestedDark: ".dark [data-theme='layered']",
    },
];
