import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import { expectNoA11yViolations } from './support/axe';
import { addSqliteConnection, newSignedInContext } from './support/auth';

// One shared, signed-in page: Fortify throttles logins to 5 per minute.
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
    // A context (not browser.newPage()) so that axe can open its own page in it.
    ({ context, page } = await newSignedInContext(browser));
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
    await page
        .getByRole('link', { name: 'Open Browse demo', exact: true })
        .click();
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

const dock = () => page.getByRole('region', { name: 'SQL editor' });
/** The active editor tab's text as Monaco renders it (spaces come out as no-break spaces). */
const editorText = async () =>
    (await dock().locator('.view-lines').innerText())
        .replace(/\u00a0/g, ' ')
        .trim();
/** Replaces the active editor tab's text, the way a user selects all and types. */
async function setEditorText(sql: string) {
    await dock().locator('.monaco-editor').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(sql);
    await expect.poll(editorText).toContain(sql);
}
const tab = (name: string) => tabs().getByRole('tab', { name, exact: true });

test('table views: a duplicated tab keeps its own filters; Open in new tab', async () => {
    await addSqliteConnection(
        page,
        'Views demo',
        path.resolve('storage/app/demo/commerce.sqlite'),
    );
    await page
        .getByRole('link', { name: 'Open Views demo', exact: true })
        .click();
    await expect(page.locator('[data-universe-ready="true"]')).toBeVisible({
        timeout: 30_000,
    });

    await sidebarRow('orders').dblclick();
    await panel().getByRole('button', { name: 'Filter status' }).click();
    await page.keyboard.type('paid');
    await page.keyboard.press('Enter');
    await expect(panel().getByText('status contains paid')).toBeVisible();

    // The copy opens beside it, active, with the same filter; the first view has no &view=.
    await expect(page).not.toHaveURL(/[?&]view=/);
    await tab('orders').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Duplicate tab' }).click();
    await expect(tab('orders (2)')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/[?&]tab=orders&view=2/);
    await expect(panel().getByText('status contains paid')).toBeVisible();

    // Filter the copy differently.
    await panel()
        .getByRole('button', { name: 'Remove filter status contains paid' })
        .click();
    await panel().getByRole('button', { name: 'Filter status' }).click();
    await page.keyboard.type('pend');
    await page.keyboard.press('Enter');
    await expect(panel().getByText('status contains pend')).toBeVisible();
    await expect(
        panel().getByRole('gridcell', { name: 'pending', exact: true }),
    ).toBeVisible();
    await expect(
        panel().getByRole('gridcell', { name: 'paid', exact: true }),
    ).toHaveCount(0);
    // The tooltips summarise each view's filters.
    await expect(tab('orders (2)')).toHaveAttribute(
        'title',
        'status contains pend',
    );
    await expect(tab('orders')).toHaveAttribute(
        'title',
        'status contains paid',
    );

    // Switching between them: each keeps its own filter and rows.
    await tab('orders').click();
    await expect(panel().getByText('status contains paid')).toBeVisible();
    await expect(panel().getByText('status contains pend')).toHaveCount(0);
    await expect(
        panel().getByRole('gridcell', { name: 'paid', exact: true }),
    ).toBeVisible();
    await expect(
        panel().getByRole('gridcell', { name: 'pending', exact: true }),
    ).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]view=/);
    await tab('orders (2)').click();
    await expect(panel().getByText('status contains pend')).toBeVisible();
    await expect(panel().getByText('status contains paid')).toHaveCount(0);
    await expect(
        panel().getByRole('gridcell', { name: 'pending', exact: true }),
    ).toBeVisible();

    // The sidebar's "Open in new tab" adds a third view with no filters.
    await sidebarRow('orders').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in new tab' }).click();
    await expect(tab('orders (3)')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/[?&]tab=orders&view=3/);
    await expect(
        panel().getByRole('button', { name: /^Remove filter/ }),
    ).toHaveCount(0);
    await expect(
        panel().getByRole('gridcell', { name: 'pending', exact: true }),
    ).toBeVisible();
    await expect(
        panel().getByRole('gridcell', { name: 'paid', exact: true }),
    ).toBeVisible();
    await tab('orders (3)').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close', exact: true }).click();
    await expect(tab('orders (3)')).toHaveCount(0);
});

test('linked SQL: apply from the editor, follow the table, undo, stale and Shown here', async () => {
    const queries: string[] = [];
    const onRequest = (r: { url(): string }) => {
        if (/\/api\/c\/\d+\/query/.test(r.url())) queries.push(r.url());
    };
    page.on('request', onRequest);

    await tab('orders').click();
    await expect(panel().getByText('status contains paid')).toBeVisible();
    await panel().getByRole('button', { name: 'Open in SQL' }).click();
    await expect(dock()).toBeVisible();
    await expect(
        dock()
            .getByRole('tablist', { name: 'SQL tabs' })
            .getByRole('tab', { name: 'orders' }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
        dock().getByRole('button', { name: 'Linked to orders' }),
    ).toBeVisible();
    await expect.poll(editorText).toMatch(/status.+like.+paid/i);

    // A fitting statement run in the linked tab sets the table tab: no query, no result grid.
    const applied = `SELECT * FROM "orders" WHERE "status" = 'pending'`;
    await setEditorText(applied);
    await page.keyboard.press('Control+Enter');
    await expect(dock().getByRole('status')).toHaveText('Applied to orders');
    await expect(panel().getByText('status equals pending')).toBeVisible();
    await expect(panel().getByText('status contains paid')).toHaveCount(0);
    await expect(
        panel().getByRole('gridcell', { name: 'pending', exact: true }),
    ).toBeVisible();
    await expect(
        panel().getByRole('gridcell', { name: 'paid', exact: true }),
    ).toHaveCount(0);
    await expect(tab('orders')).toHaveAttribute('aria-selected', 'true');
    await expect(dock().getByRole('grid')).toHaveCount(0);
    expect(queries).toEqual([]);
    // The rows that answer it do not overwrite the statement.
    expect(await editorText()).toContain(applied);

    // A filter changed in the table tab flows into the unedited editor text.
    await panel()
        .getByRole('button', { name: 'Remove filter status equals pending' })
        .click();
    await expect(
        panel().getByRole('gridcell', { name: 'paid', exact: true }),
    ).toBeVisible();
    await expect.poll(editorText).not.toContain('pending');
    const synced = await editorText();
    expect(synced).toMatch(/from\s+"?orders"?/i);
    expect(synced).not.toMatch(/where/i);
    await expect(
        dock().getByRole('button', { name: 'Linked to orders' }),
    ).toBeVisible();

    // Ctrl+Z in the editor brings back the text the sync replaced, and redo the synced text.
    await dock().locator('.monaco-editor').click();
    await page.keyboard.press('Control+z');
    await expect.poll(editorText).toContain(applied);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(editorText).toBe(synced);
    // Still so after switching to another editor tab and back.
    await dock().getByRole('button', { name: 'New query tab' }).click();
    await expect.poll(editorText).toBe('');
    await dock()
        .getByRole('tablist', { name: 'SQL tabs' })
        .getByRole('tab', { name: 'orders' })
        .click();
    await expect.poll(editorText).toBe(synced);
    await dock().locator('.monaco-editor').click();
    await page.keyboard.press('Control+z');
    await expect.poll(editorText).toContain(applied);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(editorText).toBe(synced);

    // Edited text is never overwritten: the table moving on marks the link stale instead.
    const typed = 'SELECT id, status FROM orders';
    await setEditorText(typed);
    await panel().getByRole('button', { name: 'Filter status' }).click();
    await page.keyboard.type('paid');
    await page.keyboard.press('Enter');
    await expect(panel().getByText('status contains paid')).toBeVisible();
    await expect(
        panel().getByRole('gridcell', { name: 'pending', exact: true }),
    ).toHaveCount(0);
    await expect(
        dock()
            .getByRole('status')
            .filter({ hasText: /^orders changed$/ }),
    ).toBeVisible();
    const update = dock().getByRole('button', { name: 'Update SQL' });
    await expect(update).toBeVisible();
    expect(await editorText()).toBe(typed);
    // Update SQL takes the table tab's query and ends the stale state.
    await update.click();
    await expect.poll(editorText).toMatch(/status.+like.+paid/i);
    await expect(
        dock().getByRole('button', { name: 'Linked to orders' }),
    ).toBeVisible();

    // A statement that does not fit the table runs here, with the reason; the table tab is unchanged.
    await setEditorText('SELECT status, count(*) FROM orders GROUP BY status');
    await page.keyboard.press('Control+Enter');
    await expect(
        dock().getByRole('gridcell', { name: 'pending', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(dock().getByText(/^Shown here: .+/)).toBeVisible();
    await expect(dock().getByText('Applied to')).toHaveCount(0);
    expect(queries.length).toBe(1);
    await expect(panel().getByText('status contains paid')).toBeVisible();
    await expect(
        panel().getByRole('gridcell', { name: 'pending', exact: true }),
    ).toHaveCount(0);
    await expect(tab('orders')).toHaveAttribute('aria-selected', 'true');

    page.off('request', onRequest);

    // With two views each linked, switching table tabs switches the editor tab, and the other way round.
    const sqlTab = (name: string) =>
        dock()
            .getByRole('tablist', { name: 'SQL tabs' })
            .getByRole('tab', { name, exact: true });
    const grouped = await editorText();
    expect(grouped).toMatch(/group by/i);
    await tab('orders (2)').click();
    await expect(sqlTab('orders')).toHaveAttribute('aria-selected', 'true');
    await panel().getByRole('button', { name: 'Open in SQL' }).click();
    await expect(sqlTab('orders (2)')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(editorText).toMatch(/status.+like.+pend/i);
    await tab('orders').click();
    await expect(sqlTab('orders')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(editorText).toBe(grouped);
    // Following never moves keyboard focus into the editor.
    await expect(tab('orders')).toBeFocused();
    await tab('orders (2)').click();
    await expect(sqlTab('orders (2)')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(editorText).toMatch(/status.+like.+pend/i);
    await expect(tab('orders (2)')).toBeFocused();
    await sqlTab('orders').click();
    await expect(tab('orders')).toHaveAttribute('aria-selected', 'true');
    await expect(panel().getByText('status contains paid')).toBeVisible();
    await sqlTab('orders (2)').click();
    await expect(tab('orders (2)')).toHaveAttribute('aria-selected', 'true');
    await expect(panel().getByText('status contains pend')).toBeVisible();
    // An unlinked editor tab leaves the table tab as it is.
    await sqlTab('Query 2').click();
    await expect.poll(editorText).toBe('');
    await expect(tab('orders (2)')).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: 'Close SQL editor' }).click();
    await expect(dock()).toBeHidden();
});

test('browse: 2,000-table sidebar scrolls without long tasks', async () => {
    test.setTimeout(240_000);
    await addSqliteConnection(
        page,
        'Large browse',
        path.resolve('storage/app/demo/large.sqlite'),
    );
    await page
        .getByRole('link', { name: 'Open Large browse', exact: true })
        .click();
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
    // Prefix groups would fold the 2,000 tables into a short list; measure every row.
    const grouping = page.getByRole('button', { name: 'Group by prefix' });
    await grouping.click();
    await expect(grouping).toHaveAttribute('aria-pressed', 'false');

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

test('browse: tables sharing a prefix collapse into a group', async () => {
    await addSqliteConnection(
        page,
        'Groups demo',
        path.resolve('storage/app/demo/commerce.sqlite'),
    );
    await page
        .getByRole('link', { name: 'Open Groups demo', exact: true })
        .click();
    const tree = page.getByRole('tree', { name: 'Tables' });
    // The 2,000-table test above measures the flat list; grouping is a remembered setting.
    const toggle = page.getByRole('button', { name: 'Group by prefix' });
    if ((await toggle.getAttribute('aria-pressed')) === 'false')
        await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    const group = tree.getByRole('treeitem', {
        name: 'order_ group, 2 tables',
    });
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebarRow('order_items')).toHaveCount(0);
    await group.focus();
    await page.keyboard.press('Enter');
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebarRow('order_items')).toBeVisible();

    await sidebarRow('order_totals').click();
    await expect(
        tabs().getByRole('tab', { name: 'order_totals' }),
    ).toBeVisible();
});
