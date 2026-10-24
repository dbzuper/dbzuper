import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expectNoA11yViolations, settleStyles } from './support/axe';
import { addSqliteConnection, newSignedInContext } from './support/auth';

/**
 * Staged editing writes to the database, so this spec works on its own copy of the demo database (inside the
 * directory DBSUPERB_SQLITE_PATHS allows) and never touches the shared one other specs read.
 */
const DEMO = path.resolve('storage/app/demo/commerce.sqlite');
const COPY = path.resolve('storage/app/demo/editing-e2e.sqlite');
/** Longer than the 4,000 characters a cell shows: the grid only holds it shortened. */
const LONG_TEXT_CHARS = 5000;

// One shared, signed-in page: Fortify throttles logins to 5 per minute.
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
    fs.copyFileSync(DEMO, COPY);
    // Grace Hopper's profile becomes a long text the grid shows shortened.
    execFileSync('php', [
        '-r',
        '$p = new PDO("sqlite:" . $argv[1]); $p->prepare("UPDATE users SET profile = ? WHERE id = 3")->execute([str_repeat("x", (int) $argv[2])]);',
        COPY,
        String(LONG_TEXT_CHARS),
    ]);
    // Reuses the session browse.spec saved, when there is one: no extra login.
    ({ context, page } = await newSignedInContext(browser));
    await addSqliteConnection(page, 'Editing demo', COPY);
    await openWorkspace('Editing demo');
});

test.afterAll(async () => {
    await context.close();
    // The copy is this spec's own: leave nothing behind (a file still held open is skipped, not an error).
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
        try {
            fs.rmSync(COPY + suffix, { force: true, maxRetries: 3 });
        } catch {
            // Still held open by the server: the next run's copy replaces it.
        }
    }
});

async function openWorkspace(name: string) {
    await page.goto('/connections');
    await page.getByRole('link', { name: new RegExp(name) }).click();
    await expect(page.locator('[data-universe-ready="true"]')).toBeVisible({
        timeout: 30_000,
    });
}

const sidebarRow = (name: string) =>
    page
        .getByRole('tree', { name: 'Tables' })
        .getByRole('treeitem', { name: new RegExp(`^${name}(,|$)`) })
        .first();
const tabs = () => page.getByRole('tablist', { name: 'Open tabs' });
const tab = (name: string) => tabs().getByRole('tab', { name, exact: true });
/** The workspace's tab panel (the inspector's own tab panels live outside <main>). */
const panel = () => page.getByRole('main').getByRole('tabpanel');
const cell = (text: string) =>
    panel().getByRole('gridcell', { name: text, exact: true });
const pendingBar = () => panel().getByText(/^\d+ pending changes? ·/);
const review = () =>
    page.getByRole('dialog', { name: /^Review \d+ changes? to/ });

/** Double-clicks a cell, types a value in its inline editor and keeps it with Enter. */
async function editCell(text: string, column: string, value: string) {
    await cell(text).first().dblclick();
    const input = panel().getByRole('textbox', { name: column, exact: true });
    await expect(input).toBeFocused();
    await input.fill(value);
    await page.keyboard.press('Enter');
    await expect(input).toHaveCount(0);
}

async function openTable(name: string) {
    await sidebarRow(name).dblclick();
    await expect(tab(name)).toHaveAttribute('aria-selected', 'true');
}

test('editing: edit a cell, review the UPDATE, commit; the value persists', async () => {
    await openTable('orders');
    await editCell('pending', 'status', 'shipped');
    await expect(pendingBar()).toHaveText(
        '1 pending change · 0 new · 1 edited · 0 deleted',
    );
    // The edited cell shows the staged value, marked as edited with the original in its tooltip.
    await expect(
        panel().locator('[data-edited="true"][title="Original: pending"]'),
    ).toContainText('shipped');

    await panel().getByRole('button', { name: 'Review & commit…' }).click();
    await expect(review()).toBeVisible();
    await expect(review().locator('pre')).toHaveText(
        /^UPDATE "orders" SET "status" = 'shipped' WHERE "id" = 2 AND "status" = 'pending'$/,
    );
    await review().getByRole('button', { name: 'Commit 1 change' }).click();
    await expect(review()).toHaveCount(0);
    await expect(page.getByText('1 change committed')).toBeVisible();
    await expect(pendingBar()).toHaveCount(0);
    await expect(cell('shipped')).toBeVisible();

    await page.reload();
    await expect(tab('orders')).toHaveAttribute('aria-selected', 'true');
    await expect(cell('shipped')).toBeVisible();
    await expect(cell('pending')).toHaveCount(0);
});

test('editing: add a row and delete a row in one commit', async () => {
    await openTable('group');
    await panel().getByRole('button', { name: 'Add row' }).click();
    // The new row: id left to its default, name NOT NULL without a default.
    await expect(cell('(default)')).toBeVisible();
    await editCell('required', 'name', 'Partners');
    await cell('Customers').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete row' }).click();
    await expect(pendingBar()).toHaveText(
        '2 pending changes · 1 new · 0 edited · 1 deleted',
    );

    await panel().getByRole('button', { name: 'Review & commit…' }).click();
    const statements = review().locator('pre');
    // Deletes run before inserts.
    await expect(statements).toHaveText([
        /^DELETE FROM "group" WHERE "id" = 2/,
        /^INSERT INTO "group" .*'Partners'/,
    ]);
    await review().getByRole('button', { name: 'Commit 2 changes' }).click();
    await expect(review()).toHaveCount(0);
    await expect(page.getByText('2 changes committed')).toBeVisible();
    await expect(cell('Partners')).toBeVisible();
    await expect(cell('Customers')).toHaveCount(0);

    await page.reload();
    await expect(tab('group')).toHaveAttribute('aria-selected', 'true');
    await expect(cell('Partners')).toBeVisible();
    await expect(cell('Staff')).toBeVisible();
    await expect(cell('Customers')).toHaveCount(0);
});

test('editing: a long text cell is read-only; the rest of its row is not', async () => {
    await openTable('users');
    // Another cell of the row edits inline.
    await cell('Grace Hopper').dblclick();
    const name = panel().getByRole('textbox', { name: 'name', exact: true });
    await expect(name).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(name).toHaveCount(0);

    // The long profile is held shortened: locked, with the reason in its tooltip.
    const locked = panel().locator(
        '[data-locked="true"][title="Not editable: shortened for display"]',
    );
    await expect(locked).toHaveCount(1);
    await locked.dblclick({ position: { x: 4, y: 4 } });
    await expect(
        panel().getByRole('textbox', { name: 'profile', exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(pendingBar()).toHaveCount(0);
});

test('editing: views of a table share pending changes; Ctrl+S reviews; closing the last view asks', async () => {
    await openTable('orders');
    await editCell('paid', 'status', 'refunded');
    await expect(pendingBar()).toHaveText(
        '1 pending change · 0 new · 1 edited · 0 deleted',
    );

    // A second view of the table shows the same change and adds to the same set.
    await tab('orders').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Duplicate tab' }).click();
    await expect(tab('orders (2)')).toHaveAttribute('aria-selected', 'true');
    await expect(pendingBar()).toHaveText(
        '1 pending change · 0 new · 1 edited · 0 deleted',
    );
    await expect(
        panel().locator('[data-edited="true"][title="Original: paid"]'),
    ).toContainText('refunded');
    await editCell('shipped', 'status', 'delivered');
    await expect(pendingBar()).toHaveText(
        '2 pending changes · 0 new · 2 edited · 0 deleted',
    );
    await tab('orders').click();
    await expect(pendingBar()).toHaveText(
        '2 pending changes · 0 new · 2 edited · 0 deleted',
    );
    await expect(cell('delivered edited')).toBeVisible();

    // Ctrl+S with focus in the table tab opens Review & commit; Back keeps everything staged.
    await cell('delivered edited').click();
    await page.keyboard.press('Control+s');
    await expect(
        page.getByRole('dialog', { name: 'Review 2 changes to orders' }),
    ).toBeVisible();
    await expect(review().locator('pre')).toHaveCount(2);
    await review().getByRole('button', { name: 'Back' }).click();
    await expect(review()).toHaveCount(0);
    await expect(pendingBar()).toBeVisible();

    // Leaving the page with pending changes asks the browser's "leave page?" question.
    expect(
        await page.evaluate(() => {
            const event = new Event('beforeunload', { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        }),
    ).toBe(true);

    // Closing a view while another view of the table is open keeps the changes, without asking.
    await tab('orders (2)').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close', exact: true }).click();
    await expect(tab('orders (2)')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(pendingBar()).toHaveText(/^2 pending changes/);

    // Closing the last view asks; Keep changes leaves the tab open.
    const discard = page.getByRole('dialog', {
        name: 'Discard 2 pending changes to `orders`?',
    });
    await tab('orders').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close', exact: true }).click();
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: 'Keep changes' }).click();
    await expect(discard).toHaveCount(0);
    await expect(tab('orders')).toBeVisible();
    await expect(pendingBar()).toHaveText(/^2 pending changes/);

    // Discard closes it and drops the changes: nothing was written.
    await tab('orders').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close', exact: true }).click();
    await discard.getByRole('button', { name: 'Discard' }).click();
    await expect(tab('orders')).toHaveCount(0);
    await openTable('orders');
    await expect(pendingBar()).toHaveCount(0);
    await expect(cell('paid')).toBeVisible();
    await expect(cell('shipped')).toBeVisible();
});

test('editing: a row changed elsewhere since it was loaded is not overwritten', async () => {
    await editCell('shipped', 'status', 'returned');
    await expect(pendingBar()).toHaveText(/^1 pending change ·/);

    // The same row changes through the SQL editor before the commit.
    await page.keyboard.press('Control+j');
    const dock = page.getByRole('region', { name: 'SQL editor' });
    await expect(dock.locator('.monaco-editor')).toBeVisible();
    await dock.locator('.monaco-editor').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(
        "UPDATE orders SET status = 'cancelled' WHERE id = 2",
    );
    await page.keyboard.press('Control+Enter');
    await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Run UPDATE' })
        .click();
    await expect(dock.getByText('1 rows affected')).toBeVisible({
        timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Close SQL editor' }).click();
    await expect(dock).toBeHidden();

    await panel().getByRole('button', { name: 'Review & commit…' }).click();
    await review().getByRole('button', { name: 'Commit 1 change' }).click();
    await expect(review().getByRole('alert')).toContainText(
        'Nothing was changed.',
    );
    await expect(review().getByRole('alert')).toContainText(
        'row changed since you loaded it',
    );
    // The change stays staged, its row marked with the error.
    await review().getByRole('button', { name: 'Back' }).click();
    await expect(pendingBar()).toHaveText(/^1 pending change ·/);
    await expect(
        panel().getByText(
            'edited row, failed: row changed since you loaded it',
        ),
    ).toBeAttached();

    // Nothing was written: after a reload (accepting "leave page?") the row holds the other change.
    page.once('dialog', (dialog) => {
        expect(dialog.type()).toBe('beforeunload');
        void dialog.accept();
    });
    await page.reload();
    await expect(tab('orders')).toHaveAttribute('aria-selected', 'true');
    await expect(cell('cancelled')).toBeVisible();
    await expect(cell('returned')).toHaveCount(0);
    await expect(pendingBar()).toHaveCount(0);
});

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

test('editing: set a datetime in the row drawer with the date picker, review, discard', async () => {
    await expect(tab('orders')).toHaveAttribute('aria-selected', 'true');
    await panel().getByRole('button', { name: 'Open row' }).first().click();
    const drawer = page.getByRole('complementary', { name: 'Row details' });
    await expect(
        drawer.getByRole('heading', { name: 'orders · 1' }),
    ).toBeVisible();
    const field = drawer.getByRole('textbox', {
        name: 'created_at',
        exact: true,
    });
    await expect(field).toHaveValue('2026-10-01 12:00:00');
    const picker = page.getByRole('dialog', { name: 'Choose a date' });
    const open = drawer.getByRole('button', { name: 'Choose date' });
    await expect(open).toHaveCount(1);

    // Accessibility of the open picker, dark then light; Escape closes only the picker.
    await open.click();
    await expect(picker.getByLabel('Date', { exact: true })).toHaveValue(
        '2026-10-01',
    );
    await expectNoA11yViolations(page, { label: 'edit date picker: dark' });
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await expect(field).toBeFocused();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await switchTheme('light');
    await open.click();
    await expect(picker).toBeVisible();
    await expectNoA11yViolations(page, { label: 'edit date picker: light' });
    await page.keyboard.press('Escape');
    await switchTheme('dark');
    await page.emulateMedia({ reducedMotion: null });

    // Pick 15 October 2026 at 09:30:15 and apply: staged, focus back on the field.
    await open.click();
    await picker.getByRole('button', { name: /^15 October 2026/ }).click();
    await picker.getByLabel('Time', { exact: true }).fill('09:30:15');
    await picker.getByRole('button', { name: 'Apply' }).click();
    await expect(picker).toHaveCount(0);
    await expect(field).toHaveValue('2026-10-15 09:30:15');
    await expect(field).toBeFocused();
    await expect(pendingBar()).toHaveText(
        '1 pending change · 0 new · 1 edited · 0 deleted',
    );
    await expect(
        panel().locator(
            '.rdg-cell-edited [data-edited="true"][title="Original: 2026-10-01 12:00:00"]',
        ),
    ).toContainText('2026-10-15 09:30:15');

    await panel().getByRole('button', { name: 'Review & commit…' }).click();
    await expect(review().locator('pre')).toHaveText(
        /^UPDATE "orders" SET "created_at" = '2026-10-15 09:30:15' WHERE "id" = 1/,
    );
    await review().getByRole('button', { name: 'Back' }).click();
    await expect(review()).toHaveCount(0);

    // Nothing is written: discard the change.
    await panel().getByRole('button', { name: 'Discard', exact: true }).click();
    await page
        .getByRole('dialog', { name: /^Discard 1 pending change/ })
        .getByRole('button', { name: 'Discard', exact: true })
        .click();
    await expect(pendingBar()).toHaveCount(0);
    await expect(field).toHaveValue('2026-10-01 12:00:00');
    await drawer.getByRole('button', { name: 'Close row details' }).click();
    await expect(drawer).toHaveCount(0);
});

test('editing: set a datetime in a grid cell with the date picker, then discard', async () => {
    await expect(tab('orders')).toHaveAttribute('aria-selected', 'true');
    await cell('2026-10-01 12:00:00').first().dblclick();
    const input = panel().getByRole('textbox', {
        name: 'created_at',
        exact: true,
    });
    await expect(input).toBeFocused();
    await panel().getByRole('button', { name: 'Choose date' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a date' });
    await picker.getByRole('button', { name: /^20 October 2026/ }).click();
    await picker.getByRole('button', { name: 'Apply' }).click();
    await expect(picker).toHaveCount(0);
    await expect(input).toHaveCount(0);
    await expect(
        panel().locator(
            '.rdg-cell-edited [data-edited="true"][title="Original: 2026-10-01 12:00:00"]',
        ),
    ).toContainText('2026-10-20 12:00:00');
    await expect(pendingBar()).toHaveText(
        '1 pending change · 0 new · 1 edited · 0 deleted',
    );

    await panel().getByRole('button', { name: 'Discard', exact: true }).click();
    await page
        .getByRole('dialog', { name: /^Discard 1 pending change/ })
        .getByRole('button', { name: 'Discard', exact: true })
        .click();
    await expect(pendingBar()).toHaveCount(0);
    await expect(cell('2026-10-20 12:00:00')).toHaveCount(0);
});

test('browse: the whole row-button cell opens and closes the row drawer', async () => {
    await expect(tab('orders')).toHaveAttribute('aria-selected', 'true');
    const rowButton = panel().getByRole('button', { name: 'Open row' }).first();
    const rowButtonCell = rowButton.locator(
        'xpath=ancestor::*[@role="gridcell"][1]',
    );
    const drawer = page.getByRole('complementary', { name: 'Row details' });
    // A corner of the cell, well away from the 14px icon.
    await rowButtonCell.click({ position: { x: 3, y: 3 } });
    await expect(drawer).toBeVisible();
    await expect(rowButton).toHaveAttribute('aria-expanded', 'true');
    const box = (await rowButtonCell.boundingBox())!;
    await rowButtonCell.click({ position: { x: box.width - 3, y: 3 } });
    await expect(drawer).toHaveCount(0);
    await expect(rowButton).toHaveAttribute('aria-expanded', 'false');
});

test('editing: clearing a nullable integer in the row drawer stages NULL, then discard', async () => {
    // users.group_id is a nullable unsignedBigInteger in the commerce demo.
    await openTable('users');
    await panel().getByRole('button', { name: 'Open row' }).first().click();
    const drawer = page.getByRole('complementary', { name: 'Row details' });
    await expect(
        drawer.getByRole('heading', { name: 'users · 1' }),
    ).toBeVisible();
    const field = drawer.getByRole('textbox', {
        name: 'group_id',
        exact: true,
    });
    await expect(field).toHaveValue('1');
    await field.fill('');
    await page.keyboard.press('Enter');
    await expect(pendingBar()).toHaveText(
        '1 pending change · 0 new · 1 edited · 0 deleted',
    );
    await expect(field).toHaveAttribute('placeholder', 'NULL');

    await panel().getByRole('button', { name: 'Review & commit…' }).click();
    await expect(review().locator('pre')).toHaveText(
        /^UPDATE "users" SET "group_id" = NULL WHERE "id" = 1/i,
    );
    await review().getByRole('button', { name: 'Back' }).click();
    await expect(review()).toHaveCount(0);

    await panel().getByRole('button', { name: 'Discard', exact: true }).click();
    await page
        .getByRole('dialog', { name: /^Discard 1 pending change/ })
        .getByRole('button', { name: 'Discard', exact: true })
        .click();
    await expect(pendingBar()).toHaveCount(0);
    await expect(field).toHaveValue('1');
    await drawer.getByRole('button', { name: 'Close row details' }).click();
    await expect(drawer).toHaveCount(0);
});

test('editing: a read-only connection shows no editing', async () => {
    await page.goto('/connections/create');
    await page.getByLabel('Name', { exact: true }).fill('Editing read-only');
    await page.getByLabel('Engine').selectOption('sqlite');
    await page.getByLabel('SQLite file path').fill(COPY);
    await page.getByLabel('Read-only (enforced by the database)').check();
    await page.getByRole('button', { name: 'Add connection' }).click();
    await expect(page).toHaveURL(/\/connections$/);
    await openWorkspace('Editing read-only');

    await openTable('orders');
    await expect(cell('cancelled')).toBeVisible();
    await expect(panel().getByRole('button', { name: 'Add row' })).toHaveCount(
        0,
    );
    await cell('cancelled').dblclick();
    await expect(
        panel().getByRole('textbox', { name: 'status', exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await cell('paid').click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(
        page.getByRole('menuitem', { name: 'Delete row' }),
    ).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Set NULL' })).toHaveCount(
        0,
    );
    await page.keyboard.press('Escape');
    await cell('paid').click();
    await page.keyboard.press('Delete');
    await expect(pendingBar()).toHaveCount(0);
});
