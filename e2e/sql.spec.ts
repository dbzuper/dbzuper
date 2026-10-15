import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { addSqliteConnection, ensureSignedIn } from './support/auth';

const DEMO = path.resolve('storage/app/demo/commerce.sqlite');

// One shared, signed-in page: Fortify throttles logins to 5 per minute, and the whole e2e suite
// signs in once per test.
test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await ensureSignedIn(page);
});

test.afterAll(async () => {
    await page.close();
});

test('sql: write, run, confirm, inspect results and history', async () => {
    await addSqliteConnection(page, 'SQL flow demo', DEMO);
    await page.getByRole('link', { name: /SQL flow demo/ }).click();
    await expect(page.getByRole('button', { name: 'SQL' })).toBeVisible();

    await page.keyboard.press('Control+j');
    const dock = page.getByRole('region', { name: 'SQL editor' });
    await expect(dock.locator('.monaco-editor')).toBeVisible();

    // A read runs straight away and the grid shows the demo order statuses.
    await dock.locator('.monaco-editor').click();
    await page.keyboard.type('select * from orders');
    await page.keyboard.press('Control+Enter');
    await expect(
        dock.getByRole('gridcell', { name: 'paid', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
        dock.getByRole('gridcell', { name: 'pending', exact: true }),
    ).toBeVisible();

    // A destructive statement needs the table name typed.
    await page.keyboard.press('Control+a');
    await page.keyboard.type('delete from audit_log');
    await page.keyboard.press('Control+Enter');
    const dialog = page.getByRole('dialog');
    const run = dialog.getByRole('button', { name: 'Run DELETE' });
    await expect(run).toBeDisabled();
    await dialog.getByLabel('Type audit_log to confirm').fill('audit_log');
    await expect(run).toBeEnabled();
    await run.click();
    await expect(dock.getByText('1 rows affected')).toBeVisible({
        timeout: 15_000,
    });

    // A syntax error is reported in the results panel. SQLite reports no error position, so
    // there is no editor marker here (Monaco markers are covered by the unit tests).
    await dock.locator('.monaco-editor').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('select * form users');
    await page.keyboard.press('Control+Enter');
    await expect(dock.getByRole('alert')).toContainText(/syntax error/i, {
        timeout: 15_000,
    });

    // History lists the statements.
    await page.getByRole('button', { name: 'History' }).click();
    const history = page.getByRole('complementary', { name: 'History' });
    await expect(history.getByText('delete from audit_log')).toBeVisible();
    await expect(history.getByText('select * from orders')).toBeVisible();
});

test('data tab: filter, sort and open in SQL', async () => {
    await addSqliteConnection(page, 'Data tab demo', DEMO);
    await page.getByRole('link', { name: /Data tab demo/ }).click();
    await expect(page.locator('[data-universe-ready="true"]')).toBeVisible({
        timeout: 30_000,
    });

    await page.keyboard.press('Control+k');
    await page
        .getByPlaceholder('Search tables, columns and actions…')
        .fill('orders');
    await page
        .getByRole('option', { name: /^orders/ })
        .first()
        .click();
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await inspector.getByRole('tab', { name: 'Data' }).click();
    await expect(
        inspector.getByRole('gridcell', { name: 'pending', exact: true }),
    ).toBeVisible();

    // Filter: only paid orders remain.
    await inspector.getByLabel('Filter column').selectOption('status');
    await inspector.getByLabel('Filter value').fill('paid');
    await inspector.getByRole('button', { name: 'Add filter' }).click();
    await expect(
        inspector.getByRole('gridcell', { name: 'pending', exact: true }),
    ).toHaveCount(0);
    await expect(
        inspector.getByRole('gridcell', { name: 'paid', exact: true }),
    ).toHaveCount(1);

    // Open in SQL carries the filter into the dock.
    await inspector.getByRole('button', { name: 'Open in SQL' }).click();
    const dock = page.getByRole('region', { name: 'SQL editor' });
    await expect(dock).toBeVisible();
    await expect(dock.locator('.view-lines')).toContainText(
        /where.+status.+=.+paid/i,
        {
            timeout: 15_000,
        },
    );
});

test('data tab: server sort by column header', async () => {
    await addSqliteConnection(page, 'Data sort demo', DEMO);
    await page.getByRole('link', { name: /Data sort demo/ }).click();
    await expect(page.locator('[data-universe-ready="true"]')).toBeVisible({
        timeout: 30_000,
    });
    await page.keyboard.press('Control+k');
    await page
        .getByPlaceholder('Search tables, columns and actions…')
        .fill('orders');
    await page
        .getByRole('option', { name: /^orders/ })
        .first()
        .click();
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await inspector.getByRole('tab', { name: 'Data' }).click();

    const firstStatus = async () =>
        inspector.getByRole('row').nth(1).textContent();
    await expect(
        inspector.getByRole('gridcell', { name: 'paid' }),
    ).toBeVisible();
    const before = await firstStatus();
    const header = inspector.getByRole('columnheader', {
        name: 'id',
        exact: true,
    });
    await header.click();
    await header.click();
    await expect.poll(firstStatus).not.toBe(before);
});
