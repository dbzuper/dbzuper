import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Third-party internals the app cannot fix; every entry says why. App components are never
 * excluded here: their violations are fixed with tokens and markup.
 */
const THIRD_PARTY_EXCLUDES = [
    // Monaco renders its own editor DOM (hidden textarea, view lines, widgets, decorations).
    '.monaco-editor',
    // The sigma universe is a WebGL <canvas> with no accessible DOM; the same schema is available
    // as the table list and the command palette.
    'canvas',
];

/**
 * Fails when the page has serious or critical WCAG 2.0/2.1 A/AA violations, listing each rule id,
 * impact, target selector and help URL.
 */
export async function expectNoA11yViolations(
    page: Page,
    options: { exclude?: string[]; label?: string } = {},
): Promise<void> {
    let builder = new AxeBuilder({ page }).withTags(TAGS);
    for (const selector of [
        ...THIRD_PARTY_EXCLUDES,
        ...(options.exclude ?? []),
    ])
        builder = builder.exclude(selector);

    const { violations } = await builder.analyze();
    const serious = violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    const report = serious
        .map((v) =>
            [
                `${v.id} (${v.impact}): ${v.help}`,
                ...v.nodes.map((n) =>
                    [
                        `    ${n.target.join(' ')}`,
                        `      ${n.html.slice(0, 300)}`,
                        ...(n.failureSummary ?? '')
                            .split('\n')
                            .slice(0, 3)
                            .map((line) => `      ${line}`),
                    ].join('\n'),
                ),
                `    ${v.helpUrl}`,
            ].join('\n'),
        )
        .join('\n');
    // Soft: one run lists the violations of every screen.
    expect
        .soft(
            serious.length,
            `axe violations${options.label ? ` on ${options.label}` : ''}:\n${report}`,
        )
        .toBe(0);
}
