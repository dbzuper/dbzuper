import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
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
    const toggle = page.getByRole('button', { name: /^Theme: / }).first();
    for (let i = 0; i < 3; i++) {
        if (
            (await toggle.getAttribute('aria-label'))?.startsWith(
                `Theme: ${appearance} `,
            )
        ) {
            await page.waitForFunction(
                (dark) =>
                    document.documentElement.classList.contains('dark') ===
                    dark,
                appearance === 'dark',
            );
            await settleStyles(page);
            return;
        }
        await toggle.click();
    }
    throw new Error(`Could not switch to the ${appearance} theme`);
}

test('table tab: date range filter with the picker and linked SQL', async () => {
    await addSqliteConnection(page, 'Date filter demo', DEMO);
    await page.getByRole('link', { name: /Date filter demo/ }).click();
    await expect(page.locator('[data-universe-ready="true"]')).toBeVisible({
        timeout: 30_000,
    });
    await openOrders();

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
    const now = new Date();
    const today = `created_at on ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
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
