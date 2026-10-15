import { expect, test } from '@playwright/test';
import path from 'node:path';
import { addSqliteConnection, ensureSignedIn } from './support/auth';

test.describe.configure({ mode: 'serial' });

test('universe: explore, inspect and find a path', async ({ page }) => {
    await ensureSignedIn(page);
    await addSqliteConnection(
        page,
        'Universe demo',
        path.resolve('storage/app/demo/commerce.sqlite'),
    );
    await page.getByRole('link', { name: /Universe demo/ }).click();

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
    await expect(
        inspector.getByRole('heading', { name: 'orders' }),
    ).toBeVisible();
    await expect(inspector.getByText('user_id')).toBeVisible();

    await inspector.getByRole('tab', { name: 'Relationships' }).click();
    await expect(inspector.getByText(/% inferred/)).toBeVisible();

    await inspector.getByRole('tab', { name: 'Data' }).click();
    await expect(inspector.getByText('paid')).toBeVisible();

    await inspector.getByRole('tab', { name: 'DDL' }).click();
    await expect(inspector.getByTestId('ddl')).toContainText('CREATE TABLE');

    await inspector.getByRole('button', { name: 'Find path to…' }).click();
    await page
        .getByPlaceholder('Search tables, columns and actions…')
        .fill('products');
    await page
        .getByRole('option', { name: /^products/ })
        .first()
        .click();
    await expect(page.getByRole('dialog')).toContainText(
        'orders → order_items → products',
    );
    await expect(page.getByTestId('join-sql')).toContainText('JOIN');

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'List view' }).click();
    await expect(
        page.getByRole('button', { name: 'order_items' }),
    ).toBeVisible();
});

test('universe: 2,000-table schema becomes interactive within budget', async ({
    page,
}) => {
    test.setTimeout(240_000);
    const budget = Number(process.env.E2E_UNIVERSE_BUDGET_MS ?? 2000);

    await ensureSignedIn(page);
    await addSqliteConnection(
        page,
        'Large demo',
        path.resolve('storage/app/demo/large.sqlite'),
    );
    // First visit: builds the snapshot and computes + saves the layout.
    const saved = page.waitForResponse(
        (r) =>
            r.url().includes('/layout') &&
            r.request().method() === 'PUT' &&
            r.ok(),
        { timeout: 180_000 },
    );
    await page.getByRole('link', { name: /Large demo/ }).click();
    await expect(page.locator('[data-universe-ready="true"]')).toBeVisible({
        timeout: 180_000,
    });
    await saved; // the reload must find the saved layout, not re-run the worker

    const t0 = Date.now();
    await page.reload();
    // locator.waitFor() re-checks every animation frame; expect().toBeVisible() backs off to
    // 1 s retries, which would add up to a second of polling delay to the measurement.
    await page
        .locator('[data-universe-ready="true"]')
        .waitFor({ state: 'visible', timeout: 30_000 });
    const elapsed = Date.now() - t0;

    test.info().annotations.push({
        type: 'universe-ready-ms',
        description: String(elapsed),
    });
    console.log(`universe-ready-ms=${elapsed}`);
    expect(elapsed).toBeLessThan(budget);
});
