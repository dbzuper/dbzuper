import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import { chooseMode, chooseTheme } from './support/appearance';
import { expectNoA11yViolations, settleStyles } from './support/axe';
import { addSqliteConnection, newSignedInContext } from './support/auth';

// One shared, signed-in page: Fortify throttles logins to 5 per minute.
test.describe.configure({ mode: 'serial' });

const DEMO = path.resolve('storage/app/demo/commerce.sqlite');
const NAME = 'Home demo';
const OTHER = 'Home other';
const SQL = 'select * from orders';
const SHOTS = path.resolve('test-results/connections-home');
const THEMES = [
    { name: 'classic', label: 'Classic' },
    { name: 'layered', label: 'Layered' },
    { name: 'graphite', label: 'Graphite' },
] as const;
const MODES = ['light', 'dark'] as const;

let context: BrowserContext;
let page: Page;
/** The workspace path of the Home demo connection, e.g. /c/12. */
let workspace = '';

test.beforeAll(async ({ browser }) => {
    ({ context, page } = await newSignedInContext(browser));
    await addSqliteConnection(page, NAME, DEMO);
    await addSqliteConnection(page, OTHER, DEMO);
});

// Later serial specs share the saved session: leave it on Classic and the default (dark) mode.
test.afterAll(async () => {
    try {
        await page.emulateMedia({ reducedMotion: null });
        await chooseTheme(page, 'Classic');
        await chooseMode(page, 'dark');
    } finally {
        await context.close();
    }
});

const card = (name: string) =>
    page.getByRole('link', { name: `Open ${name}`, exact: true });
const search = () => page.getByPlaceholder('Find a connection');
const dock = () => page.getByRole('region', { name: 'SQL editor' });
/** A sidebar group by its exact label ("Recent" is not "Recent queries"). */
const sidebarGroup = (label: RegExp) =>
    page.locator('[data-slot="sidebar-group"]').filter({
        has: page.locator('[data-slot="sidebar-group-label"]', {
            hasText: label,
        }),
    });
const recent = () => sidebarGroup(/^Recent$/);
const recentQueries = () => sidebarGroup(/^Recent queries/);

async function gotoConnections() {
    await page.goto('/connections');
    await expect(
        page.getByRole('heading', { name: 'Your databases', level: 1 }),
    ).toBeVisible();
}

async function expectWorkspace() {
    await expect(page).toHaveURL(/\/c\/\d+$/);
    await expect(
        page.getByRole('button', { name: 'SQL', exact: true }),
    ).toBeVisible();
}

test('connections home: a card per connection, search filters, the card opens the workspace', async () => {
    await gotoConnections();
    await expect(card(NAME)).toBeVisible();
    await expect(card(OTHER)).toBeVisible();

    await search().fill(NAME);
    await expect(card(NAME)).toBeVisible();
    await expect(card(OTHER)).toHaveCount(0);
    await search().fill('');
    await expect(card(OTHER)).toBeVisible();

    await card(NAME).click();
    await expectWorkspace();
    workspace = new URL(page.url()).pathname;
});

test('connections home: the sidebar Recent lists the opened connection', async () => {
    await gotoConnections();
    const link = recent().getByRole('link', { name: new RegExp(NAME) });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', workspace);
    // Never opened, so not recent.
    await expect(
        recent().getByRole('link', { name: new RegExp(OTHER) }),
    ).toHaveCount(0);
});

test('connections home: Recent queries lists a run statement and reopens it in the SQL dock', async () => {
    await page.goto(workspace);
    await expectWorkspace();
    await page.keyboard.press('Control+j');
    await expect(dock().locator('.monaco-editor')).toBeVisible();
    await dock().locator('.monaco-editor').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(SQL);
    await page.keyboard.press('Control+Enter');
    await expect(
        dock().getByRole('gridcell', { name: 'paid', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    // Close the dock so that the reopened workspace only shows it because of the history entry.
    await page.keyboard.press('Control+j');
    await expect(dock()).toBeHidden();

    await gotoConnections();
    const entry = recentQueries().getByRole('link', {
        name: new RegExp(`${SQL.replace('*', '\\*')}.*${NAME}`),
    });
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute(
        'href',
        new RegExp(`^${workspace}\\?history=\\d+$`),
    );

    await entry.click();
    // The workspace reads ?history once and drops it from the address.
    await expect(page).toHaveURL(new RegExp(`${workspace}$`));
    await expect(dock().locator('.monaco-editor')).toBeVisible({
        timeout: 15_000,
    });
    await expect(dock().locator('.view-lines')).toContainText(SQL);
});

test('connections home: no serious or critical axe violations in light and dark', async () => {
    // Reduced motion removes colour transitions and the card entrance, so axe never samples in-between colours.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoConnections();
    await expect(card(NAME)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Tip' })).toBeVisible();
    for (const mode of MODES) {
        await chooseMode(page, mode);
        await page.waitForFunction(
            (dark) =>
                document.documentElement.classList.contains('dark') === dark,
            mode === 'dark',
        );
        await expectNoA11yViolations(page, { label: `/connections, ${mode}` });
    }
    await page.emulateMedia({ reducedMotion: null });
});

test('connections home: screenshots of every theme and mode', async () => {
    await gotoConnections();
    await expect(card(NAME)).toBeVisible();
    for (const theme of THEMES) {
        await chooseTheme(page, theme.label);
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
