import {
    expect,
    test,
    type BrowserContext,
    type Page,
    type Request,
} from '@playwright/test';
import path from 'node:path';
import { chooseMode } from './support/appearance';
import { expectNoA11yViolations, settleStyles } from './support/axe';
import { addSqliteConnection, ensureSignedIn } from './support/auth';

const DEMO = path.resolve('storage/app/demo/commerce.sqlite');

// One shared, signed-in page: Fortify throttles logins to 5 per minute, and the whole e2e suite
// signs in once per test.
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
    // A context (not browser.newPage()) so that axe can open its own page in it.
    context = await browser.newContext();
    page = await context.newPage();
    await ensureSignedIn(page, (pathname) =>
        expectNoA11yViolations(page, { label: pathname }),
    );
});

test.afterAll(async () => {
    await context.close();
});

const PALETTE_PLACEHOLDER = 'Search tables, columns and actions…';

async function openWorkspace(name: string) {
    await addSqliteConnection(page, name, DEMO);
    await page.getByRole('link', { name: `Open ${name}`, exact: true }).click();
    await expect(page.locator('[data-universe-ready="true"]')).toBeVisible({
        timeout: 30_000,
    });
}

async function openRecordFromPalette(query: string, option: string | RegExp) {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(PALETTE_PLACEHOLDER).fill(query);
    await page.getByRole('option', { name: option }).click();
}

/** The workspace's tab panel (the inspector's own tab panels live outside <main>). */
const browsePanel = () => page.getByRole('main').getByRole('tabpanel');

/** Opens a table's tab from the command palette (a plain pick opens the table tab). */
async function openTableFromPalette(table: string) {
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(PALETTE_PLACEHOLDER).fill(table);
    await page
        .getByRole('option', { name: new RegExp(`^${table}`) })
        .first()
        .click();
    await expect(
        page
            .getByRole('tablist', { name: 'Open tabs' })
            .getByRole('tab', { name: table, exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
}

test('records: entry points (result row, table tab row) and tables without a primary key', async () => {
    await openWorkspace('Records entry demo');

    // A result row opens its record.
    await page.keyboard.press('Control+j');
    const dock = page.getByRole('region', { name: 'SQL editor' });
    await expect(dock.locator('.monaco-editor')).toBeVisible();
    await dock.locator('.monaco-editor').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('select * from orders');
    await page.keyboard.press('Control+Enter');
    await expect(
        dock.getByRole('gridcell', { name: 'paid', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await dock
        .getByRole('button', { name: 'Open record', exact: true })
        .first()
        .click();
    const explorer = page.getByRole('region', { name: 'Record explorer' });
    await expect(explorer.locator('.react-flow__node-record')).toHaveCount(1);
    await expect(
        explorer.getByRole('button', { name: 'orders 1', exact: true }),
    ).toBeVisible();
    await expect(
        explorer
            .getByRole('navigation', { name: 'Record path' })
            .getByRole('button', { name: 'orders · 1', exact: true }),
    ).toBeVisible();

    // A table tab row opens its record (row drawer -> Explore graph): users row 3 is Grace Hopper.
    // The dock stays open: it takes its own space below the tab panel instead of covering it.
    await expect(dock).toBeVisible();
    await openTableFromPalette('users');
    const panel = browsePanel();
    await expect(
        panel.getByRole('gridcell', { name: 'Grace Hopper' }),
    ).toBeVisible();
    await panel
        .getByRole('row')
        .filter({ hasText: 'Grace Hopper' })
        .getByRole('button', { name: 'Open row', exact: true })
        .click();
    const drawer = page.getByRole('complementary', { name: 'Row details' });
    await expect(
        drawer.getByRole('heading', { name: 'users · 3' }),
    ).toBeVisible();
    // The pager sits above the dock; the drawer runs full height in its own column beside it.
    const dockBox = (await dock.boundingBox())!;
    const pagerBox = (await page.getByLabel('Rows per page').boundingBox())!;
    expect(pagerBox.y + pagerBox.height).toBeLessThanOrEqual(dockBox.y);
    const drawerBox = (await drawer.boundingBox())!;
    expect(drawerBox.x).toBeGreaterThanOrEqual(dockBox.x + dockBox.width - 1);
    expect(drawerBox.y + drawerBox.height).toBeGreaterThanOrEqual(
        dockBox.y + dockBox.height - 1,
    );
    // The grid fills the space down to the pager (react-data-grid's own 350px default must not win).
    const fill = await panel
        .locator('.rdg-dbzuper')
        .evaluate((grid) => [
            grid.getBoundingClientRect().height,
            grid.parentElement!.getBoundingClientRect().height,
        ]);
    expect(fill[0]).toBeCloseTo(fill[1], 0);
    // The open row's frozen cells are opaque, so cells scrolled underneath them don't show through.
    const frozenBackground = await panel
        .locator('.rdg-row-active > .rdg-cell-frozen-start')
        .first()
        .evaluate((cell) => getComputedStyle(cell).backgroundColor);
    expect(frozenBackground).not.toMatch(/(\/\s*0?\.\d+|,\s*0?\.\d+)\)$/);
    await drawer.getByRole('button', { name: 'Explore graph' }).click();
    await expect(explorer.getByText('Grace Hopper').first()).toBeVisible();

    // A table without a primary key: no palette record option and no record action on its rows.
    // (This test runs before the destructive DELETE below, so audit_log still has rows.)
    await page.keyboard.press('Control+k');
    const search = page.getByPlaceholder(PALETTE_PLACEHOLDER);
    await search.fill('audit_log');
    // Positive signal first: the table itself is offered, so the search has settled.
    await expect(
        page.getByRole('option', { name: /^audit_log/ }),
    ).toBeVisible();
    await search.fill('audit_log 1');
    await expect(page.getByText('No matches.')).toBeVisible();
    await expect(page.getByRole('option', { name: /Open record/ })).toHaveCount(
        0,
    );
    await page.keyboard.press('Escape');
    await openTableFromPalette('audit_log');
    // Header row plus at least one data row has rendered before asserting the absence.
    await expect.poll(() => panel.getByRole('row').count()).toBeGreaterThan(1);
    await expect(
        panel.getByRole('button', { name: 'Open record', exact: true }),
    ).toHaveCount(0);
    // Its rows still open in the drawer, which shows values only: no relations, no graph.
    await panel
        .getByRole('button', { name: 'Open row', exact: true })
        .first()
        .click();
    await expect(
        drawer.getByText(
            'Relations are available for tables with a primary key.',
        ),
    ).toBeVisible();
    await expect(
        drawer.getByRole('button', { name: 'Explore graph' }),
    ).toHaveCount(0);
});

test('sql: write, run, confirm, inspect results and history', async () => {
    await addSqliteConnection(page, 'SQL flow demo', DEMO);
    await page
        .getByRole('link', { name: 'Open SQL flow demo', exact: true })
        .click();
    await expect(
        page.getByRole('button', { name: 'SQL', exact: true }),
    ).toBeVisible();

    await page.keyboard.press('Control+j');
    const dock = page.getByRole('region', { name: 'SQL editor' });
    await expect(dock.locator('.monaco-editor')).toBeVisible();

    // The editor takes focus when the dock opens, and the workspace shortcuts still work from it:
    // Ctrl+K opens the palette (not a Monaco chord), Esc returns to the editor, Ctrl+J closes the dock.
    await expect(dock.locator('.monaco-editor')).toContainClass('focused');
    await page.keyboard.press('Control+k');
    const palette = page.getByPlaceholder(PALETTE_PLACEHOLDER);
    await expect(palette).toBeFocused();
    await page.keyboard.type('orders');
    await expect(palette).toHaveValue('orders');
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(dock.locator('.monaco-editor')).toContainClass('focused');
    await page.keyboard.press('Control+j');
    await expect(dock).toBeHidden();
    await page.keyboard.press('Control+j');
    await expect(dock.locator('.monaco-editor')).toContainClass('focused');

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

test('table tab: filter, sort and open in SQL', async () => {
    await addSqliteConnection(page, 'Table tab demo', DEMO);
    await page
        .getByRole('link', { name: 'Open Table tab demo', exact: true })
        .click();
    await expect(page.locator('[data-universe-ready="true"]')).toBeVisible({
        timeout: 30_000,
    });

    await openTableFromPalette('orders');
    const panel = browsePanel();
    await expect(
        panel.getByRole('gridcell', { name: 'pending', exact: true }),
    ).toBeVisible();

    // Filter: only paid orders remain.
    await panel.getByLabel('Filter column').selectOption('status');
    await panel.getByLabel('Filter value').fill('paid');
    await panel.getByRole('button', { name: 'Add filter' }).click();
    await expect(
        panel.getByRole('gridcell', { name: 'pending', exact: true }),
    ).toHaveCount(0);
    await expect(
        panel.getByRole('gridcell', { name: 'paid', exact: true }),
    ).toHaveCount(1);

    // Open in SQL carries the filter into the dock.
    await panel.getByRole('button', { name: 'Open in SQL' }).click();
    const dock = page.getByRole('region', { name: 'SQL editor' });
    await expect(dock).toBeVisible();
    await expect(dock.locator('.view-lines')).toContainText(
        /where.+status.+=.+paid/i,
        {
            timeout: 15_000,
        },
    );
});

test('table tab: server sort by column header', async () => {
    await addSqliteConnection(page, 'Data sort demo', DEMO);
    await page
        .getByRole('link', { name: 'Open Data sort demo', exact: true })
        .click();
    await expect(page.locator('[data-universe-ready="true"]')).toBeVisible({
        timeout: 30_000,
    });
    await openTableFromPalette('orders');
    const panel = browsePanel();

    const firstStatus = async () => panel.getByRole('row').nth(1).textContent();
    await expect(panel.getByRole('gridcell', { name: 'paid' })).toBeVisible();
    const before = await firstStatus();
    // The header's name also carries its "Filter id" button.
    const header = panel.getByRole('columnheader', { name: /^id\b/ });
    await header.click();
    await header.click();
    await expect.poll(firstStatus).not.toBe(before);
});

const b64url = (text: string) =>
    Buffer.from(text, 'utf8')
        .toString('base64')
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');

test('records: Back/Forward restore the trail without remounting or refetching', async () => {
    await addSqliteConnection(page, 'Records history demo', DEMO);
    await page
        .getByRole('link', { name: 'Open Records history demo', exact: true })
        .click();
    await expect(
        page.getByRole('button', { name: 'SQL', exact: true }),
    ).toBeVisible();
    const workspace = new URL(page.url()).pathname;

    // users #1 as the root, built the way the app encodes it.
    const r = b64url(
        JSON.stringify({ v: 1, n: [['users', [1]]], e: [], s: 0 }),
    );
    await page.goto(`${workspace}?r=${r}`);
    const explorer = page.getByRole('region', { name: 'Record explorer' });
    await expect(explorer.getByText('users').first()).toBeVisible();

    // Expand the group port (belongs-to).
    await explorer.getByRole('button', { name: /^Open group/ }).click();
    await expect
        .poll(() => explorer.locator('.react-flow__node-record').count())
        .toBeGreaterThan(1);
    const withGroup = await explorer
        .locator('.react-flow__node-record')
        .count();
    const expandedUrl = page.url();

    await page.keyboard.press('Control+j');
    const dock = page.getByRole('region', { name: 'SQL editor' });
    await expect(dock.locator('.monaco-editor')).toBeVisible();

    const seen: string[] = [];
    const onRequest = (req: Request) => {
        if (req.method() === 'GET') seen.push(new URL(req.url()).pathname);
    };
    page.on('request', onRequest);

    await page.goBack();
    await expect(explorer.locator('.react-flow__node-record')).toHaveCount(1);
    await expect(dock).toBeVisible();
    expect(page.url()).toContain(`r=${r}`);

    // Back refetches nothing: every node on screen was already loaded.
    expect(seen.filter((p) => /\/records\//.test(p))).toEqual([]);
    expect(seen.filter((p) => /\/schema|\/layout/.test(p))).toEqual([]);
    seen.length = 0;

    await page.goForward();
    await expect(explorer.locator('.react-flow__node-record')).toHaveCount(
        withGroup,
    );
    await expect(dock).toBeVisible();
    expect(page.url()).toBe(expandedUrl);

    page.off('request', onRequest);
    expect(seen.filter((p) => /\/schema|\/layout/.test(p))).toEqual([]);
    // Forward re-adds the group card, which Back had dropped from the cache: one record fetch for
    // it, never the users record that stayed loaded.
    expect(seen.filter((p) => /\/records\/users/.test(p))).toEqual([]);
});

test('records: palette, three hops, Back/Forward, Copy path as SQL, run, and the expansion budget', async () => {
    await openWorkspace('Records flow demo');
    // orders.user_id -> users is an inferred relationship in the demo; its port needs the toggle.
    const showInferred = page.getByRole('button', { name: 'Show inferred' });
    if (await showInferred.isVisible()) await showInferred.click();
    await expect(
        page.getByRole('button', { name: 'Hide inferred' }),
    ).toBeVisible();

    // 1. Open users 2 from the command palette.
    await openRecordFromPalette('users 2', 'Open record users · 2');
    const explorer = page.getByRole('region', { name: 'Record explorer' });
    const cards = explorer.locator('.react-flow__node-record');
    await expect(cards).toHaveCount(1);
    await expect(explorer.getByText('Alan Turing').first()).toBeVisible();

    // 2. Hop 1: users -> orders (timed for the expansion budget).
    // Timed inside the page, so Playwright round-trips are not counted: from the click event to
    // the second card being in the DOM.
    await page.evaluate(() => {
        const root = document.querySelector(
            '[aria-label="Record explorer"]',
        ) as HTMLElement;
        const w = window as unknown as { __expandMs?: Promise<number> };
        w.__expandMs = new Promise<number>((resolve) => {
            root.addEventListener(
                'click',
                () => {
                    const t0 = performance.now();
                    const observer = new MutationObserver(() => {
                        if (
                            root.querySelectorAll('.react-flow__node-record')
                                .length >= 2
                        ) {
                            observer.disconnect();
                            resolve(performance.now() - t0);
                        }
                    });
                    observer.observe(root, { childList: true, subtree: true });
                },
                { capture: true, once: true },
            );
        });
    });
    await explorer
        .getByRole('button', { name: /^Show orders \(user_id\), 1 record/ })
        .click();
    await expect(cards).toHaveCount(2);
    const elapsed = await page.evaluate(
        () => (window as unknown as { __expandMs: Promise<number> }).__expandMs,
    );
    console.log(`record-expand-ms=${Math.round(elapsed)}`);
    expect(elapsed).toBeLessThan(300);

    // 3. Hop 2: order 1 -> its two items.
    await explorer
        .getByRole('button', {
            name: /^Show order_items \(order_id\), 2 records/,
        })
        .click();
    await expect(cards).toHaveCount(4);

    // 4. Hop 3: item 1 -> its product (opening a parent selects it).
    await explorer.getByRole('button', { name: 'Fit View' }).click();
    await explorer
        .getByRole('button', { name: /^Open products \(product_id\)/ })
        .first()
        .click();
    await expect(cards).toHaveCount(5);
    await expect(
        explorer.getByText('Mechanical Keyboard').first(),
    ).toBeVisible();

    // 5. The breadcrumb lists the path; Back removes the product card, Forward restores it.
    const crumbs = explorer
        .getByRole('navigation', { name: 'Record path' })
        .locator('[data-crumb]');
    await expect(crumbs).toHaveCount(4);
    const tables = (await crumbs.allTextContents()).map(
        (t) => t.split(' · ')[0],
    );
    expect(tables).toEqual(['users', 'orders', 'order_items', 'products']);

    await page.goBack();
    await expect(cards).toHaveCount(4);
    await page.goForward();
    await expect(cards).toHaveCount(5);
    await expect(crumbs).toHaveCount(4);

    // 6. Copy path as SQL opens a "Record path" tab holding the JOIN chain.
    await explorer.getByRole('button', { name: 'Copy path as SQL' }).click();
    const dock = page.getByRole('region', { name: 'SQL editor' });
    await expect(dock.locator('.monaco-editor')).toBeVisible();
    await expect(page.getByText('Record path').first()).toBeVisible();
    const editor = dock.locator('.view-lines');
    await expect(editor).toContainText('JOIN "orders"');
    await expect(editor).toContainText('JOIN "order_items"');
    await expect(editor).toContainText('JOIN "products"');
    await expect(editor).toContainText('WHERE t0."id" = 2');

    // 7. Running it is a read: no confirmation, and the keyboard shows up in the grid.
    await dock.locator('.monaco-editor').click();
    await page.keyboard.press('Control+Enter');
    await expect(
        dock.getByRole('gridcell', { name: 'Mechanical Keyboard' }),
    ).toBeVisible({ timeout: 15_000 });
});

/** Picks a mode in the real Appearance menu and waits until the page has fully repainted in it. */
async function switchTheme(appearance: 'dark' | 'light') {
    // The foreground colour of the theme being left: once the switch has fully repainted, no element
    // may still be drawn in it (axe sampling a half-restyled page reported dark text on light).
    const foreground = () =>
        page.evaluate(() => {
            const probe = document.createElement('span');
            probe.className = 'text-foreground';
            document.body.append(probe);
            const colour = getComputedStyle(probe).color;
            probe.remove();
            return colour;
        });
    const previous = await foreground();
    await chooseMode(page, appearance);
    // The class and colour-scheme the menu sets are the signal that the theme applied.
    await page.waitForFunction(
        (dark) =>
            document.documentElement.classList.contains('dark') === dark &&
            document.documentElement.style.colorScheme ===
                (dark ? 'dark' : 'light'),
        appearance === 'dark',
    );
    if ((await foreground()) !== previous) {
        await settleStyles(page);
        await page.waitForFunction(
            (stale) =>
                ![...document.querySelectorAll('body *')].some(
                    (el) =>
                        el.getClientRects().length > 0 &&
                        getComputedStyle(el).color === stale,
                ),
            previous,
            { polling: 'raf', timeout: 5_000 },
        );
    }
}

const b64urlTrail = (text: string) =>
    Buffer.from(text, 'utf8')
        .toString('base64')
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');

test('accessibility: no serious or critical axe violations on the main screens', async () => {
    // The login screen is checked before sign-in, in beforeAll. Everything here reuses the shared
    // signed-in page.
    await page.goto('/connections');
    await expect(
        page.getByRole('heading', { name: 'Your databases', level: 1 }),
    ).toBeVisible();
    await expectNoA11yViolations(page, { label: '/connections' });

    await page.goto('/connections/create');
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
    await expectNoA11yViolations(page, { label: '/connections/create' });

    // Workspace: universe.
    await openWorkspace('A11y workspace demo');
    await expectNoA11yViolations(page, { label: 'workspace: universe' });

    // Table sidebar (beside the universe).
    await expect(
        page
            .getByRole('tree', { name: 'Tables' })
            .getByRole('treeitem', { name: /^products,/ }),
    ).toBeVisible();
    await expectNoA11yViolations(page, { label: 'workspace: sidebar' });

    // Records view with a card (users 1, built the way the app encodes it).
    const workspace = new URL(page.url()).pathname;
    const trail = b64urlTrail(
        JSON.stringify({ v: 1, n: [['users', [1]]], e: [], s: 0 }),
    );
    await page.goto(`${workspace}?r=${trail}`);
    const explorer = page.getByRole('region', { name: 'Record explorer' });
    await expect(
        explorer.getByRole('button', { name: /^Open group/ }),
    ).toBeVisible();
    await expectNoA11yViolations(page, { label: 'workspace: records' });

    // SQL dock open with a result.
    await page.keyboard.press('Control+j');
    const dock = page.getByRole('region', { name: 'SQL editor' });
    await expect(dock.locator('.monaco-editor')).toBeVisible();
    await dock.locator('.monaco-editor').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('select * from orders');
    await page.keyboard.press('Control+Enter');
    await expect(
        dock.getByRole('gridcell', { name: 'paid', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expectNoA11yViolations(page, { label: 'workspace: SQL dock' });

    // Inspector (Shift+click keeps the palette's inspector behaviour), then its Open table tab.
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder(PALETTE_PLACEHOLDER).fill('orders');
    await page
        .getByRole('option', { name: /^orders/ })
        .first()
        .click({ modifiers: ['Shift'] });
    const inspector = page.getByRole('complementary', { name: 'Inspector' });
    await expect(
        inspector.getByRole('heading', { name: 'orders' }),
    ).toBeVisible();
    await inspector.getByRole('tab', { name: 'Columns' }).click();
    await expectNoA11yViolations(page, {
        label: 'workspace: inspector Columns',
    });
    await inspector.getByRole('button', { name: 'Open data' }).click();
    await expect(
        browsePanel().getByRole('gridcell', { name: 'pending', exact: true }),
    ).toBeVisible();
    await expectNoA11yViolations(page, { label: 'workspace: table tab' });

    // History panel.
    await page.getByRole('button', { name: 'History' }).click();
    const history = page.getByRole('complementary', { name: 'History' });
    await expect(history.getByText('select * from orders')).toBeVisible();
    await expectNoA11yViolations(page, { label: 'workspace: history panel' });

    // One light pass on the workspace (dark is the default theme).
    // Reduced motion removes colour transitions, so axe never samples in-between colours.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await switchTheme('light');
    await expectNoA11yViolations(page, { label: 'workspace: light' });
    await page
        .getByRole('tablist', { name: 'Open tabs' })
        .getByRole('tab', { name: /^Records/ })
        .click();
    await expectNoA11yViolations(page, { label: 'workspace: records, light' });
    await switchTheme('dark');
    await page.emulateMedia({ reducedMotion: null });

    // The global history page.
    await page.goto('/history');
    await expect(page.getByText('select * from orders').first()).toBeVisible();
    await expectNoA11yViolations(page, { label: '/history' });
});
