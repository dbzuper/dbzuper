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

/** How long a finite transition or animation may take to finish before the check fails. */
const SETTLE_TIMEOUT_MS = 2_000;

/**
 * Waits until no finite CSS transition or animation is running. Under reduced motion the app shortens
 * them to 0.01 ms, but a transition still starts one frame late, so a computed colour read straight
 * after a theme or view change can still be the old one. Infinite animations (spinners, skeleton
 * pulses) never finish and are ignored. Two rounds cover transitions started by the restyle that the
 * first round finished. Throws, listing what is still running, instead of hanging.
 */
export async function settleStyles(page: Page): Promise<void> {
    await page.evaluate(async (timeoutMs) => {
        const frame = () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
            );
        const finite = () =>
            document
                .getAnimations()
                .filter(
                    (a) =>
                        a.effect?.getComputedTiming().endTime !== Infinity &&
                        a.playState === 'running',
                );
        const describe = (a: Animation) => {
            const target = (a.effect as KeyframeEffect | null)?.target;
            const name =
                a instanceof CSSTransition
                    ? `transition ${a.transitionProperty}`
                    : a instanceof CSSAnimation
                      ? `animation ${a.animationName}`
                      : 'animation';
            return `${name} on ${target?.tagName.toLowerCase() ?? '?'}${
                target?.className
                    ? `.${String(target.className).split(' ')[0]}`
                    : ''
            }`;
        };
        let timer = 0;
        const timeout = new Promise<never>((_, reject) => {
            timer = window.setTimeout(
                () =>
                    reject(
                        new Error(
                            `Styles did not settle within ${timeoutMs} ms; still running: ${finite()
                                .map(describe)
                                .join(', ')}`,
                        ),
                    ),
                timeoutMs,
            );
        });
        const settle = async () => {
            for (let round = 0; round < 2; round++) {
                await frame();
                await Promise.all(
                    finite().map((a) => a.finished.catch(() => undefined)),
                );
            }
            await frame();
        };
        try {
            await Promise.race([settle(), timeout]);
        } finally {
            clearTimeout(timer);
        }
    }, SETTLE_TIMEOUT_MS);
}

/**
 * Fails when the page has serious or critical WCAG 2.0/2.1 A/AA violations, listing each rule id,
 * impact, target selector and help URL.
 */
export async function expectNoA11yViolations(
    page: Page,
    options: { exclude?: string[]; label?: string } = {},
): Promise<void> {
    await settleStyles(page);
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
