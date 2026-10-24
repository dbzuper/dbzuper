import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import {
    chooseMode,
    closeAppearanceMenu,
    openAppearanceMenu,
} from './support/appearance';
import { expectNoA11yViolations, settleStyles } from './support/axe';
import { addSqliteConnection, newSignedInContext } from './support/auth';

const DEMO = path.resolve('storage/app/demo/commerce.sqlite');
const PALETTE_PLACEHOLDER = 'Search tables, columns and actions…';

// The commerce demo seeds both orders at 2026-10-01 12:00:00 (CommerceSchema::seed), so a range
// that includes that day selects both rows and one that starts the day after selects none.
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
    ({ context, page } = await newSignedInContext(browser));
});

test.afterAll(async () => {
    await context.close();
});

const panel = () => page.getByRole('main').getByRole('tabpanel');
const dock = () => page.getByRole('region', { name: 'SQL editor' });
const picker = () => page.getByRole('dialog', { name: 'Choose a date' });
const valueButton = () => panel().getByRole('button', { name: 'Filter value' });
const cell = (name: string) =>
    panel().getByRole('gridcell', { name, exact: true });

const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
];

async function openOrders() {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(PALETTE_PLACEHOLDER).fill('orders');
    await page
        .getByRole('option', { name: /^orders/ })
        .first()
        .click();
    await expect(cell('pending')).toBeVisible();
}

async function chooseCreatedAt(operator: string) {
    await panel().getByLabel('Filter column').selectOption('created_at');
    await panel()
        .getByLabel('Filter operator')
        .selectOption({ label: operator });
}

async function applyRange(from: string, to: string) {
    await chooseCreatedAt('between');
    await valueButton().click();
    await picker().getByLabel('From', { exact: true }).fill(from);
    await picker().getByLabel('To', { exact: true }).fill(to);
    await picker().getByRole('button', { name: 'Apply' }).click();
    await expect(picker()).toHaveCount(0);
}

async function switchTheme(appearance: 'dark' | 'light') {
    await chooseMode(page, appearance);
    await page.waitForFunction(
        (dark) => document.documentElement.classList.contains('dark') === dark,
        appearance === 'dark',
    );
    await settleStyles(page);
}

test('table tab: date range filter with the picker and linked SQL', async () => {
    await addSqliteConnection(page, 'Date filter demo', DEMO);
    await page.getByRole('link', { name: /Date filter demo/ }).click();
    await expect(page.locator('[data-universe-ready="true"]')).toBeVisible({
        timeout: 30_000,
    });
    await openOrders();

    // The picker's chunk is fetched once the browser is idle after the table opens (orders has date columns)...
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestIdleCallback(() => resolve()),
            ),
    );
    await expect
        .poll(() =>
            page.evaluate(() =>
                performance
                    .getEntriesByType('resource')
                    .some((e) =>
                        /\/build\/.*date-picker-[^/]*\.js$/.test(e.name),
                    ),
            ),
        )
        .toBe(true);
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestIdleCallback(() => resolve()),
            ),
    );
    // ...so the first picker opens on its calendar, never on the loading spinner.
    await page.evaluate(() => {
        const w = window as Window & { spinnerSeen?: boolean };
        w.spinnerSeen = false;
        const seen = () =>
            document.querySelector(
                '[role="dialog"] [role="status"][aria-label="Loading"]',
            ) !== null;
        new MutationObserver(() => {
            if (seen()) w.spinnerSeen = true;
        }).observe(document.body, { childList: true, subtree: true });
    });
    await chooseCreatedAt('on');
    await valueButton().click();
    await expect(picker().getByRole('status', { name: 'Loading' })).toHaveCount(
        0,
    );
    await expect(picker().getByRole('grid')).toBeVisible();
    expect(
        await page.evaluate(
            () => (window as Window & { spinnerSeen?: boolean }).spinnerSeen,
        ),
    ).toBe(false);
    await page.keyboard.press('Escape');
    await expect(picker()).toHaveCount(0);

    // A date column swaps the value control for the picker button.
    await chooseCreatedAt('between');
    await expect(valueButton()).toHaveText(/Pick a date/);

    // A range that spans the demo orders' day keeps both rows.
    const included = 'created_at between 1 Oct 2026 → 15 Oct 2026';
    await applyRange('2026-10-01', '2026-10-15');
    await expect(panel().getByText(included)).toBeVisible();
    await expect(cell('paid')).toBeVisible();
    await expect(cell('pending')).toBeVisible();

    // A range that starts the day after selects none of them.
    await panel()
        .getByRole('button', { name: `Remove filter ${included}` })
        .click();
    await applyRange('2026-10-02', '2026-10-15');
    const after = 'created_at between 2 Oct 2026 → 15 Oct 2026';
    await expect(panel().getByText(after)).toBeVisible();
    await expect(cell('paid')).toHaveCount(0);
    await expect(cell('pending')).toHaveCount(0);
    await panel()
        .getByRole('button', { name: `Remove filter ${after}` })
        .click();
    await expect(cell('pending')).toBeVisible();

    // The "Today" quick range is a single day: it applies as "on".
    await chooseCreatedAt('between');
    await valueButton().click();
    await picker().getByRole('button', { name: 'Today', exact: true }).click();
    // The page's calendar day (its time zone may differ from this Node process's).
    const [year, month, day] = await page.evaluate(() => {
        const d = new Date();
        return [d.getFullYear(), d.getMonth(), d.getDate()];
    });
    const today = `created_at on ${day} ${MONTHS[month]} ${year}`;
    await expect(panel().getByText(today)).toBeVisible();
    await expect(picker()).toHaveCount(0);
    await panel()
        .getByRole('button', { name: `Remove filter ${today}` })
        .click();

    // An exact day through the single-date picker.
    await chooseCreatedAt('on');
    await valueButton().click();
    await picker().getByLabel('Date', { exact: true }).fill('2026-10-01');
    await picker().getByRole('button', { name: 'Apply' }).click();
    const on = 'created_at on 1 Oct 2026';
    await expect(panel().getByText(on)).toBeVisible();
    await expect(cell('paid')).toBeVisible();

    // Keyboard: Escape closes the picker and focus returns to the value button.
    await valueButton().focus();
    await page.keyboard.press('Enter');
    await expect(picker()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker()).toHaveCount(0);
    await expect(valueButton()).toBeFocused();

    // Add the range as well, then take both filters into the linked editor.
    await applyRange('2026-10-01', '2026-10-15');
    await expect(panel().getByText(included)).toBeVisible();
    await panel().getByRole('button', { name: 'Open in SQL' }).click();
    await expect(dock()).toBeVisible();
    await expect(
        dock().getByRole('button', { name: 'Linked to orders' }),
    ).toBeVisible();
    await expect(dock().locator('.view-lines')).toContainText(/created_at/, {
        timeout: 15_000,
    });

    // Running the linked query unchanged keeps both chips and shows no unlinked result pane.
    await dock().locator('.monaco-editor').click();
    await page.keyboard.press('Control+Enter');
    await expect(dock().getByRole('status')).toHaveText('Applied to orders');
    await expect(dock().getByRole('grid')).toHaveCount(0);
    await expect(panel().getByText(included)).toBeVisible();
    await expect(panel().getByText(on, { exact: true })).toBeVisible();
    await expect(panel().getByText(/created_at (on|between)/)).toHaveCount(2);
    await expect(cell('paid')).toBeVisible();
    await expect(
        dock().getByRole('button', { name: 'Linked to orders' }),
    ).toBeVisible();
});

test('accessibility: the opened date picker, dark and light', async () => {
    await valueButton().click();
    await expect(picker()).toBeVisible();
    await expectNoA11yViolations(page, { label: 'date picker: dark' });
    await page.keyboard.press('Escape');
    await expect(picker()).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await switchTheme('light');
    await valueButton().click();
    await expect(picker()).toBeVisible();
    await expectNoA11yViolations(page, { label: 'date picker: light' });
    await page.keyboard.press('Escape');
    await switchTheme('dark');
    await page.emulateMedia({ reducedMotion: null });
});

test('appearance menu: each swatch draws its own theme in both modes, whatever the page theme', async () => {
    const THEMES = ['classic', 'layered', 'graphite'] as const;
    const LABELS = {
        classic: 'Classic',
        layered: 'Layered',
        graphite: 'Graphite',
    };

    type Look = Record<string, string>;
    // What the tokens draw: on the page itself (a probe under <body>, which follows <html>'s theme), or
    // on each swatch's dots. Shell tokens are read as the custom properties the element sees.
    const looks = (where: 'page' | 'swatches') =>
        page.evaluate((where) => {
            const look = (root: Element) => {
                const dot = (cls: string) =>
                    getComputedStyle(root.querySelector(`.${cls}`)!)
                        .backgroundColor;
                const style = getComputedStyle(root);
                return {
                    background: dot('bg-background'),
                    sidebar: dot('bg-sidebar'),
                    primary: dot('bg-primary'),
                    shellGap: style.getPropertyValue('--shell-gap').trim(),
                    panelRadius: style
                        .getPropertyValue('--panel-radius')
                        .trim(),
                };
            };
            if (where === 'swatches') {
                return Object.fromEntries(
                    ['classic', 'layered', 'graphite'].map((name) => [
                        name,
                        look(
                            document.querySelector(
                                `[role="radiogroup"] [data-theme="${name}"]`,
                            )!,
                        ),
                    ]),
                );
            }
            const probe = document.createElement('span');
            probe.innerHTML =
                '<i class="bg-background"></i><i class="bg-sidebar"></i><i class="bg-primary"></i>';
            document.body.append(probe);
            const result = look(probe);
            probe.remove();
            return { page: result };
        }, where) as Promise<Record<string, Look>>;

    for (const mode of ['dark', 'light'] as const) {
        await switchTheme(mode);
        const menu = await openAppearanceMenu(page);
        const themeGroup = menu.getByRole('radiogroup', { name: 'Theme' });

        // Each theme's own look, read from the page while that theme is active.
        const own: Record<string, Look> = {};
        for (const name of THEMES) {
            await themeGroup.getByRole('radio', { name: LABELS[name] }).click();
            await expect(page.locator('html')).toHaveAttribute(
                'data-theme',
                name,
            );
            own[name] = (await looks('page')).page;
        }
        expect(own.classic).not.toEqual(own.layered);
        expect(own.layered).not.toEqual(own.graphite);

        // Under every page theme, every swatch still shows its own theme.
        for (const pageTheme of THEMES) {
            await themeGroup
                .getByRole('radio', { name: LABELS[pageTheme] })
                .click();
            await expect(page.locator('html')).toHaveAttribute(
                'data-theme',
                pageTheme,
            );
            expect(
                await looks('swatches'),
                `${mode}, page ${pageTheme}`,
            ).toEqual(own);
        }

        await themeGroup.getByRole('radio', { name: 'Classic' }).click();
        await closeAppearanceMenu(page);
    }
    await switchTheme('dark');
});
