import { expect, test } from '@playwright/test';
import path from 'node:path';
import { addSqliteConnection, ensureSignedIn } from './support/auth';

test('sql dock: Monaco suggests schema tables', async ({ page }) => {
    await ensureSignedIn(page);
    await addSqliteConnection(
        page,
        'SQL demo',
        path.resolve('storage/app/demo/commerce.sqlite'),
    );
    await page.getByRole('link', { name: /SQL demo/ }).click();
    await expect(page.getByRole('button', { name: 'SQL' })).toBeVisible();

    await page.keyboard.press('Control+j');
    const dock = page.getByRole('region', { name: 'SQL editor' });
    await expect(dock).toBeVisible();

    await dock.locator('.monaco-editor').click();
    await page.keyboard.type('select * from ord');

    const widget = page.locator('.suggest-widget');
    await expect(widget).toBeVisible({ timeout: 15_000 });
    await expect(widget).toContainText('orders');
});

test('sql dock: runs the statement at the cursor and shows an error with position', async ({
    page,
}) => {
    await ensureSignedIn(page);
    await addSqliteConnection(
        page,
        'SQL run demo',
        path.resolve('storage/app/demo/commerce.sqlite'),
    );
    await page.getByRole('link', { name: /SQL run demo/ }).click();
    await expect(page.getByRole('button', { name: 'SQL' })).toBeVisible();
    await page.keyboard.press('Control+j');
    const dock = page.getByRole('region', { name: 'SQL editor' });
    await expect(dock).toBeVisible();

    await dock.locator('.monaco-editor').click();
    await page.keyboard.type('select 1 as one');
    await page.keyboard.press('Control+Enter');
    await expect(dock.getByRole('tab', { name: '#1 SELECT' })).toBeVisible({
        timeout: 15_000,
    });
    await expect(
        dock.getByRole('gridcell', { name: '1', exact: true }),
    ).toBeVisible();

    await page.keyboard.press('Control+a');
    await page.keyboard.type('select * from no_such_table');
    await dock.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(dock.getByRole('alert')).toContainText('no_such_table', {
        timeout: 15_000,
    });
});
