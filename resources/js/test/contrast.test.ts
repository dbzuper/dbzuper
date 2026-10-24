import { describe, expect, it } from 'vitest';
import { declarations, THEMES, token } from './css-tokens';

/** Text-on-surface pairs that must reach WCAG AA (4.5:1) in every theme and mode. */
const PAIRS = [
    ['foreground', 'background'],
    ['muted-foreground', 'background'],
    ['muted-foreground', 'muted'],
    ['card-foreground', 'card'],
    ['sidebar-foreground', 'sidebar'],
    ['primary-foreground', 'primary'],
    ['warning-foreground', 'background'],
] as const;

/**
 * Each block, with the blocks it falls back to for tokens it leaves out (nearest first), as the cascade
 * resolves them. A dark-themed element also matches the theme's light selector, which ties `.dark` on
 * specificity and comes later, so the light theme block wins over `.dark`.
 */
const BLOCKS: { name: string; chain: string[] }[] = [
    { name: ':root', chain: [':root'] },
    { name: '.dark', chain: ['.dark', ':root'] },
    ...THEMES.flatMap((theme) => [
        { name: theme.light, chain: [theme.light, ':root'] },
        { name: theme.dark, chain: [theme.dark, theme.light, ':root'] },
    ]),
];

type Colour = { l: number; c: number; h: number; alpha: number };

/** Resolves a token through the block's fallback chain, following var() references. */
function resolve(chain: string[], name: string): string {
    for (const selector of chain) {
        const value = token(declarations(selector), `--${name}`);

        if (value === undefined) {
            continue;
        }

        const ref = /^var\(--([\w-]+)\)$/.exec(value);

        return ref ? resolve(chain, ref[1]) : value;
    }

    throw new Error(`--${name} is not defined in ${chain[0]}`);
}

/** Parses `oklch(L C H)` or `oklch(L C H / a%)`. */
function parse(value: string): Colour {
    const m =
        /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/.exec(
            value,
        );

    if (!m) {
        throw new Error(`not an oklch colour: ${value}`);
    }

    const alpha =
        m[4] === undefined ? 1 : Number(m[4]) / (m[5] === '%' ? 100 : 1);

    return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]), alpha };
}

/** WCAG relative luminance of an oklch colour (gamut-clipped linear sRGB). */
function luminance({ l, c, h }: Colour): number {
    const a = c * Math.cos((h * Math.PI) / 180);
    const b = c * Math.sin((h * Math.PI) / 180);
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const clip = (v: number) => Math.min(1, Math.max(0, v));
    const r = clip(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
    const g = clip(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
    const bl = clip(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);

    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function ratio(a: Colour, b: Colour): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

    return (hi + 0.05) / (lo + 0.05);
}

describe('contrast', () => {
    it('computes the WCAG ratio of black on white as 21', () => {
        expect(ratio(parse('oklch(0 0 0)'), parse('oklch(1 0 0)'))).toBeCloseTo(
            21,
            1,
        );
    });

    it('parses an alpha', () => {
        expect(parse('oklch(1 0 0 / 10%)').alpha).toBeCloseTo(0.1);
    });

    const cases = BLOCKS.flatMap(({ name, chain }) =>
        PAIRS.map(([text, surface]) => ({
            block: name,
            pair: `${text}/${surface}`,
            text: parse(resolve(chain, text)),
            surface: parse(resolve(chain, surface)),
        })),
    );

    it.each(cases)('$block $pair reaches 4.5:1', ({ text, surface }) => {
        // A translucent colour's contrast depends on what lies beneath it, which this check cannot know.
        expect(
            [text.alpha, surface.alpha],
            'text pairs must use opaque colours',
        ).toEqual([1, 1]);
        expect(ratio(text, surface)).toBeGreaterThanOrEqual(4.5);
    });
});
