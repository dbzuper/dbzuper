import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import { chooseMode, chooseTheme as chooseThemeIn } from './support/appearance';
import { settleStyles } from './support/axe';
import { addSqliteConnection, newSignedInContext } from './support/auth';

// One shared, signed-in page: Fortify throttles logins to 5 per minute.
test.describe.configure({ mode: 'serial' });

const SHOTS = path.resolve('test-results/themes');
const THEMES = [
    { name: 'classic', label: 'Classic' },
    { name: 'layered', label: 'Layered' },
    { name: 'graphite', label: 'Graphite' },
    { name: 'radar', label: 'Radar' },
] as const;
const MODES = ['light', 'dark'] as const;
// Blade links Graphite's built stylesheet on first paint (no data attribute); a later switch adds the marked link.
const GRAPHITE_FONTS =
    'link[data-theme-fonts="graphite"], link[rel="stylesheet"][href*="fonts-graphite"]';

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
    ({ context, page } = await newSignedInContext(browser));
    await addSqliteConnection(
        page,
        'Themes demo',
        path.resolve('storage/app/demo/commerce.sqlite'),
    );
    await page
        .getByRole('link', { name: 'Open Themes demo', exact: true })
        .click();
    await openGroupedTable();
});

// Later serial specs share the saved session: leave it on Classic and the default (dark) mode.
test.afterAll(async () => {
    try {
        await chooseTheme('Classic');
        await chooseMode(page, 'dark');
    } finally {
        await context.close();
    }
});

const tree = () => page.getByRole('tree', { name: 'Tables' });
const tabs = () => page.getByRole('tablist', { name: 'Open tabs' });
const statusBar = () => page.getByRole('contentinfo', { name: 'Status bar' });
const dock = () => page.getByRole('region', { name: 'SQL editor' });
const sidebarRow = (name: string) =>
    tree()
        .getByRole('treeitem', { name: new RegExp(`^${name}(,|$)`) })
        .first();

/** Groups the sidebar by prefix, expands the order_ group and opens order_items in a tab. */
async function openGroupedTable() {
    const toggle = page.getByRole('button', { name: 'Group by prefix' });
    if ((await toggle.getAttribute('aria-pressed')) === 'false')
        await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const group = tree().getByRole('treeitem', {
        name: 'order_ group, 2 tables',
    });
    if ((await group.getAttribute('aria-expanded')) === 'false') {
        await group.focus();
        await page.keyboard.press('Enter');
    }
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await sidebarRow('order_items').click();
    await expect(
        tabs().getByRole('tab', { name: 'order_items' }),
    ).toBeVisible();
    await expect(
        page.getByRole('main').getByRole('tabpanel').getByRole('grid'),
    ).toBeVisible();
}

const chooseTheme = (label: string) => chooseThemeIn(page, label);

/** The status bar and the sidebar's table tree are drawn in every theme. */
async function expectChrome() {
    await expect(statusBar()).toBeVisible();
    await expect(tree()).toBeVisible();
}

const bodyFont = () =>
    page.evaluate(async () => {
        await document.fonts.ready;
        return getComputedStyle(document.body).fontFamily;
    });

/** The family is computed whether or not the woff2 arrived; check() is only true once it loaded. */
const graphiteFontLoaded = () =>
    page.evaluate(async () => {
        await document.fonts.ready;
        return document.fonts.check('12px "Schibsted Grotesk Variable"');
    });

const editorBackground = () =>
    dock()
        .locator('.monaco-editor .monaco-editor-background')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);

test('themes: Layered applies at once and is in the server HTML (no flash)', async () => {
    await chooseTheme('Layered');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'layered');
    await expectChrome();

    // The raw server response (before any script runs) already carries the theme from the cookie.
    const raw = await (await page.request.get(page.url())).text();
    expect(raw).toMatch(/<html[^>]*data-theme="layered"/);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'layered');
    await expectChrome();
});

test('themes: Graphite loads its fonts, also when server-rendered', async () => {
    await chooseTheme('Graphite');
    await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        'graphite',
    );
    await expect(page.locator('link[data-theme-fonts="graphite"]')).toHaveCount(
        1,
    );
    expect(await bodyFont()).toContain('Schibsted');
    expect(await graphiteFontLoaded()).toBe(true);
    await expectChrome();

    // After a reload Blade links the fonts itself, and the loader does not add a second link.
    const raw = await (await page.request.get(page.url())).text();
    expect(raw).toMatch(/<html[^>]*data-theme="graphite"/);
    expect(raw).toContain('fonts-graphite');
    await page.reload();
    await expect(page.locator(GRAPHITE_FONTS)).toHaveCount(1);
    expect(await bodyFont()).toContain('Schibsted');
    expect(await graphiteFontLoaded()).toBe(true);
    await expectChrome();
});

test('themes: the SQL editor follows a theme switch', async () => {
    if (!(await dock().isVisible())) await page.keyboard.press('Control+j');
    await expect(dock().locator('.monaco-editor')).toBeVisible();
    await settleStyles(page);
    const graphite = await editorBackground();

    await chooseTheme('Classic');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'classic');
    await settleStyles(page);
    await expect.poll(editorBackground).not.toBe(graphite);
    await expectChrome();

    await page.keyboard.press('Control+j');
    await expect(dock()).toBeHidden();
});

test('themes: screenshots of every theme and mode', async () => {
    // The reload above may not restore the tab or the group; reopen them for the pictures.
    if ((await tabs().getByRole('tab', { name: 'order_items' }).count()) === 0)
        await openGroupedTable();
    for (const theme of THEMES) {
        await chooseTheme(theme.label);
        for (const mode of MODES) {
            await chooseMode(page, mode);
            await expect(page.locator('html')).toHaveAttribute(
                'data-theme',
                theme.name,
            );
            await page.waitForFunction(
                (dark) =>
                    document.documentElement.classList.contains('dark') ===
                    dark,
                mode === 'dark',
            );
            await settleStyles(page);
            await page.evaluate(() => document.fonts.ready);
            await expectChrome();
            // Escape returned focus to the Appearance button; keep its ring out of the picture.
            await page.evaluate(() =>
                (document.activeElement as HTMLElement | null)?.blur(),
            );
            await page.screenshot({
                path: path.join(SHOTS, `${theme.name}-${mode}.png`),
            });
        }
    }
});

test('themes: keyboard focus ring on the first tab (Layered, light)', async () => {
    await chooseTheme('Layered');
    await chooseMode(page, 'light');
    await settleStyles(page);
    const first = tabs().getByRole('tab').first();
    // A key press first, so the browser treats the focus as keyboard focus (:focus-visible).
    await page.keyboard.press('Shift');
    await first.focus();
    await expect(first).toBeFocused();
    expect(await first.evaluate((el) => el.matches(':focus-visible'))).toBe(
        true,
    );
    await settleStyles(page);
    await page.screenshot({
        path: path.join(SHOTS, 'focus-ring-layered-light.png'),
    });
});
