import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import { expectNoA11yViolations } from './support/axe';
import { addSqliteConnection, ensureSignedIn } from './support/auth';

// One shared, signed-in page: Fortify throttles logins to 5 per minute.
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
    // A context (not browser.newPage()) so that axe can open its own page in it.
    context = await browser.newContext();
    page = await context.newPage();
    await ensureSignedIn(page);
    await addSqliteConnection(
        page,
        'Browse demo',
        path.resolve('storage/app/demo/commerce.sqlite'),
    );
});

test.afterAll(async () => {
    await context.close();
});

const sidebarRow = (name: string) =>
    page
        .getByRole('tree', { name: 'Tables' })
        // A row's name is the table and its row count ("users, 3 rows").
        .getByRole('treeitem', { name: new RegExp(`^${name}(,|$)`) })
        .first();
const tabs = () => page.getByRole('tablist', { name: 'Open tabs' });
/** The workspace's tab panel (the inspector's own tab panels live outside <main>). */
const panel = () => page.getByRole('main').getByRole('tabpanel');

test('browse: preview tab, promotion, state kept across tab switches', async () => {
    await page.getByRole('link', { name: /Browse demo/ }).click();
    await sidebarRow('users').click();
    await expect(tabs().getByRole('tab', { name: 'users' })).toHaveAttribute(
        'data-preview',
        'true',
    );
    await sidebarRow('orders').click();
    // The preview tab is reused: users is replaced by orders.
    await expect(tabs().getByRole('tab', { name: 'users' })).toHaveCount(0);
    await expect(tabs().getByRole('tab', { name: 'orders' })).toHaveAttribute(
        'data-preview',
        'true',
    );
    await sidebarRow('orders').dblclick();
    await expect(
        tabs().getByRole('tab', { name: 'orders' }),
    ).not.toHaveAttribute('data-preview', 'true');

    // A header filter button starts a "contains" filter on its column.
    await panel().getByRole('button', { name: 'Filter status' }).click();
    await expect(panel().getByLabel('Filter value')).toBeFocused();
    await page.keyboard.type('paid');
    await page.keyboard.press('Enter');
    await expect(panel().getByText('status contains paid')).toBeVisible();
    await expect(panel().getByText('Rows 1–1 of 1')).toBeVisible();

    // Another permanent tab, loaded, then back: the filter (and its rows) are still there.
    await sidebarRow('users').dblclick();
    await expect(
        panel().getByRole('gridcell', { name: 'Ada Lovelace' }),
    ).toBeVisible();
    await tabs().getByRole('tab', { name: 'orders' }).click();
    await expect(panel().getByText('status contains paid')).toBeVisible();
    await expect(panel().getByText('Rows 1–1 of 1')).toBeVisible();
    await expect(
        panel().getByRole('gridcell', { name: 'pending', exact: true }),
    ).toHaveCount(0);
});

test('browse: tab switch is instant and makes no requests (budget)', async () => {
    const budget = Number(process.env.E2E_TAB_SWITCH_BUDGET_MS ?? 100);
    const requests: string[] = [];
    const onRequest = (r: { url(): string }) => {
        if (r.url().includes('/api/')) requests.push(r.url());
    };
    page.on('request', onRequest);
    // Timed inside the page, so Playwright round-trips are not counted: from the click event to the
    // first frame that shows the users rows.
    await page.evaluate(() => {
        const list = document.querySelector(
            '[role="tablist"][aria-label="Open tabs"]',
        ) as HTMLElement;
        const w = window as unknown as { __tabSwitchMs?: Promise<number> };
        w.__tabSwitchMs = new Promise<number>((resolve) => {
            list.addEventListener(
                'click',
                () => {
                    const t0 = performance.now();
                    const shown = () =>
                        Array.from(
                            document.querySelectorAll(
                                '#browse-panel [role="gridcell"]',
                            ),
                        ).some((c) => c.textContent === 'Ada Lovelace');
                    const tick = () => {
                        if (shown()) resolve(performance.now() - t0);
                        else requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                },
                { capture: true, once: true },
            );
        });
    });
    await tabs().getByRole('tab', { name: 'users' }).click();
    await expect(
        panel().getByRole('gridcell', { name: 'Ada Lovelace' }),
    ).toBeVisible();
    const elapsed = Math.round(
        await page.evaluate(
            () =>
                (window as unknown as { __tabSwitchMs: Promise<number> })
                    .__tabSwitchMs,
        ),
    );
    page.off('request', onRequest);
    test.info().annotations.push({
        type: 'tab-switch-ms',
        description: String(elapsed),
    });
    console.log(`tab-switch-ms=${elapsed}`);
    expect(requests).toEqual([]);
    expect(elapsed).toBeLessThan(budget);
});

test('browse: table opens within budget', async () => {
    const budget = Number(process.env.E2E_TABLE_OPEN_BUDGET_MS ?? 400);
    const t0 = Date.now();
    await sidebarRow('products').dblclick();
    // Checked on every animation frame in the page: locator.waitFor() and expect() retry with
    // backoff, which would add polling delay to the measurement.
    await page.waitForFunction(
        () =>
            Array.from(
                document.querySelectorAll('#browse-panel [role="gridcell"]'),
            ).some(
                // Rendered too (not visibility: hidden or opacity 0) with a non-empty box: Playwright's
                // 'visible' state plus the opacity check.
                (c) => {
                    if (c.textContent !== 'Mechanical Keyboard') return false;
                    const rect = c.getBoundingClientRect();
                    return (
                        (c.checkVisibility?.({
                            visibilityProperty: true,
                            opacityProperty: true,
                        }) ??
                            c.getClientRects().length > 0) &&
                        rect.width > 0 &&
                        rect.height > 0
                    );
                },
            ),
        null,
        { polling: 'raf', timeout: 30_000 },
    );
    const elapsed = Date.now() - t0;
    test.info().annotations.push({
        type: 'table-open-ms',
        description: String(elapsed),
    });
    console.log(`table-open-ms=${elapsed}`);
    expect(elapsed).toBeLessThan(budget);
});

test('browse: row drawer, FK hop and back', async () => {
    await sidebarRow('orders').dblclick();
    await panel().getByRole('button', { name: 'Open row' }).first().click();
    const drawer = page.getByRole('complementary', { name: 'Row details' });
    await expect(
        drawer.getByRole('heading', { name: 'orders · 1' }),
    ).toBeVisible();
    // orders 1 belongs to user 2 (an inferred relationship).
    await drawer.getByRole('button', { name: 'users · user_id' }).click();
    await expect(
        drawer.getByRole('heading', { name: 'users · 2' }),
    ).toBeVisible();
    await expect(drawer.getByText('Alan Turing')).toBeVisible();
    await drawer.getByRole('button', { name: 'Back' }).click();
    await expect(
        drawer.getByRole('heading', { name: 'orders · 1' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    // Focus returns to the row that was open.
    await expect(panel().locator('button[data-row-index="0"]')).toBeFocused();
});

test('browse: pins survive a reload; ?tab= deep link; Ctrl+P quick open', async () => {
    await sidebarRow('users').hover();
    const saved = page.waitForResponse(
        (r) =>
            r.url().includes('/pins') &&
            r.request().method() === 'POST' &&
            r.ok(),
    );
    await page.getByRole('button', { name: 'Pin users' }).first().click();
    await saved;
    await expect(page).toHaveURL(/[?&]tab=orders/);

    await page.reload();
    await expect(
        page
            .getByRole('group', { name: 'Pinned' })
            .getByRole('treeitem', { name: /^users,/ }),
    ).toBeVisible();
    // ?tab= reopens the active table tab after the reload.
    await expect(page).toHaveURL(/[?&]tab=orders/);
    await expect(tabs().getByRole('tab', { name: 'orders' })).toHaveAttribute(
        'aria-selected',
        'true',
    );

    await page.keyboard.press('Control+p');
    await page.getByPlaceholder('Open a table…').fill('categories');
    await page.keyboard.press('Enter');
    await expect(
        tabs().getByRole('tab', { name: 'categories' }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/[?&]tab=categories/);
});

test('browse: accessibility of sidebar, tab bar and drawer', async () => {
    await panel().getByRole('button', { name: 'Open row' }).first().click();
    await expect(
        page
            .getByRole('complementary', { name: 'Row details' })
            .getByRole('heading', { name: 'categories · 1' }),
    ).toBeVisible();
    await expectNoA11yViolations(page, {
        label: 'browse: sidebar, tab bar, table tab and row drawer',
    });
});

test('browse: 2,000-table sidebar scrolls without long tasks', async () => {
    test.setTimeout(240_000);
    await addSqliteConnection(
        page,
        'Large browse',
        path.resolve('storage/app/demo/large.sqlite'),
    );
    await page.getByRole('link', { name: /Large browse/ }).click();
    const tree = page.getByRole('tree', { name: 'Tables' });
    await tree.waitFor({ timeout: 180_000 });
    // The first visit lays out and mounts the universe; measure the sidebar once that is done, so
    // only scrolling is on the main thread.
    await page
        .locator('[data-universe-ready="true"]')
        .waitFor({ state: 'visible', timeout: 180_000 });
    await expect(
        page.getByRole('group', { name: /^All tables \(\d{4,}\)$/ }),
    ).toBeVisible();

    const longest = await page.evaluate(async () => {
        const tasks: number[] = [];
        const observer = new PerformanceObserver((list) =>
            list.getEntries().forEach((e) => tasks.push(e.duration)),
        );
        observer.observe({ type: 'longtask', buffered: false });
        const scroller = document.querySelector(
            '[data-sidebar-scroll]',
        ) as HTMLElement;
        const frame = () =>
            new Promise((r) => requestAnimationFrame(() => r(null)));
        for (let y = 0; y <= scroller.scrollHeight; y += 600) {
            scroller.scrollTop = y;
            await frame();
        }
        // Let the last scroll render, then collect entries not yet delivered to the callback.
        await frame();
        await frame();
        observer.takeRecords().forEach((e) => tasks.push(e.duration));
        observer.disconnect();
        return Math.round(Math.max(0, ...tasks));
    });
    test.info().annotations.push({
        type: 'sidebar-longest-task-ms',
        description: String(longest),
    });
    console.log(`sidebar-longest-task-ms=${longest}`);
    expect(longest).toBeLessThan(50);
});
