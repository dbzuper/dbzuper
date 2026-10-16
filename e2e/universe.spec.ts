import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { addSqliteConnection, ensureSignedIn } from './support/auth';

test.describe.configure({ mode: 'serial' });

/** First contentful paint of the current page, in ms (waits for the paint entry if it is not there yet). */
async function firstContentfulPaint(page: Page): Promise<number> {
    const fcp = await page.evaluate(
        () =>
            new Promise<number>((resolve) => {
                const read = () =>
                    performance
                        .getEntriesByType('paint')
                        .find((e) => e.name === 'first-contentful-paint')
                        ?.startTime;
                const found = read();
                if (found !== undefined) return resolve(found);
                new PerformanceObserver((_list, observer) => {
                    const value = read();
                    if (value === undefined) return;
                    observer.disconnect();
                    resolve(value);
                }).observe({ type: 'paint', buffered: true });
            }),
    );
    return Math.round(fcp);
}

test('universe: explore, inspect and find a path', async ({ page }) => {
    // Monaco belongs to the SQL dock: nothing of it may load while the dock stays closed.
    const monacoRequests: string[] = [];
    page.on('request', (request) => {
        if (/monaco|editor\.api|editor\.worker|sql-dock/i.test(request.url()))
            monacoRequests.push(request.url());
    });
    await ensureSignedIn(page);
    await addSqliteConnection(
        page,
        'Universe demo',
        path.resolve('storage/app/demo/commerce.sqlite'),
    );
    await page.getByRole('link', { name: /Universe demo/ }).click();

    const stage = page.locator('[data-universe-ready="true"]');
    await expect(stage).toBeVisible({ timeout: 30_000 });
    // A small schema is labelled on first view (10 tables and views; the label grid may drop a
    // colliding one or two).
    await expect
        .poll(async () => Number(await stage.getAttribute('data-labels-shown')))
        .toBeGreaterThanOrEqual(8);

    await page.keyboard.press('Control+k');
    await page
        .getByPlaceholder('Search tables, columns and actions…')
        .fill('orders');
    // Shift+click keeps the inspector behaviour (a plain pick opens the table tab).
    await page
        .getByRole('option', { name: /^orders/ })
        .first()
        .click({ modifiers: ['Shift'] });

    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await expect(
        inspector.getByRole('heading', { name: 'orders' }),
    ).toBeVisible();
    await expect(inspector.getByText('user_id')).toBeVisible();

    await inspector.getByRole('tab', { name: 'Relationships' }).click();
    await expect(inspector.getByText(/% inferred/)).toBeVisible();

    // The inspector's rows live in the table tab now; the Universe tab brings the inspector back.
    await inspector.getByRole('button', { name: 'Open data' }).click();
    const tabs = page.getByRole('tablist', { name: 'Open tabs' });
    await expect(tabs.getByRole('tab', { name: 'orders' })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    await expect(
        page
            .getByRole('main')
            .getByRole('tabpanel')
            .getByRole('gridcell', { name: 'paid', exact: true }),
    ).toBeVisible();
    await tabs.getByRole('tab', { name: 'Universe' }).click();
    await expect(
        inspector.getByRole('heading', { name: 'orders' }),
    ).toBeVisible();

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
    expect(monacoRequests).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(
        page
            .getByRole('tree', { name: 'Tables' })
            .getByRole('treeitem', { name: /^order_items,/ }),
    ).toBeVisible();
});

test('universe: 2,000-table schema becomes interactive within budget (and the connections list paints fast)', async ({
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

    // The connections list is the first screen after sign-in: its first contentful paint has its
    // own budget (the same page, so no extra login).
    const fcpBudget = Number(process.env.E2E_CONNECTIONS_FCP_BUDGET_MS ?? 1000);
    await page.goto('/connections', { waitUntil: 'load' });
    await expect(
        page.getByRole('heading', { name: 'Connections' }),
    ).toBeVisible();
    const fcp = await firstContentfulPaint(page);
    test.info().annotations.push({
        type: 'connections-fcp-ms',
        description: String(fcp),
    });
    console.log(`connections-fcp-ms=${fcp}`);
    expect(fcp).toBeLessThan(fcpBudget);
});
