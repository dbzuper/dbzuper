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

/** The value of one custom property in a rule body (the formatter may wrap a long value onto more lines). */
export function token(body: string, name: string): string | undefined {
    const declaration = new RegExp(`^\\s*${name}:([^;]*);`, 'm').exec(body);

    return declaration?.[1].replace(/\s+/g, ' ').trim();
}

/** Every custom property name a rule body defines. */
export function properties(body: string): string[] {
    return [...body.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]);
}

/** The shell tokens: the canvas behind the workspace panels and how the panels sit on it. */
export const SHELL_TOKENS = [
    '--shell',
    '--shell-gap',
    '--panel-radius',
    '--panel-shadow',
    '--chrome-edge',
    '--sidebar-shadow',
    '--grid-header',
    '--grid-column-line',
];

/**
 * The colour themes beyond Classic: each one's light and dark selector, and its shell look (`flat` keeps
 * Classic's edge-to-edge panels, `lifted` raises them off a canvas).
 */
export const THEMES: {
    name: string;
    light: string;
    dark: string;
    nestedDark: string;
    shell: 'flat' | 'lifted';
}[] = [
    {
        name: 'layered',
        light: "[data-theme='layered']",
        dark: "[data-theme='layered'].dark",
        nestedDark: ".dark [data-theme='layered']",
        shell: 'lifted',
    },
    {
        name: 'graphite',
        light: "[data-theme='graphite']",
        dark: "[data-theme='graphite'].dark",
        nestedDark: ".dark [data-theme='graphite']",
        shell: 'flat',
    },
];
