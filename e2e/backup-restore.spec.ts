import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { chooseMode, chooseTheme } from './support/appearance';
import { addSqliteConnection, newSignedInContext } from './support/auth';
import { expectNoA11yViolations, settleStyles } from './support/axe';

// One shared, signed-in page: the restore needs the backup the earlier test downloaded.
test.describe.configure({ mode: 'serial' });

const DEMO_DIR = path.resolve('storage/app/demo');
const SOURCE = 'Backup source';
const TARGET = 'Restore target';
const TARGET_FILE = path.join(DEMO_DIR, 'restore-target.sqlite');
const OUT = path.resolve('test-results/backup-restore');
const THEME_SHOTS = process.env.THEME_SHOTS
    ? path.resolve(process.env.THEME_SHOTS)
    : null;

let context: BrowserContext;
let page: Page;
let sourcePath = '';
let backupFile = '';

test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(OUT, { recursive: true });
    // An empty SQLite file: the restore target.
    fs.rmSync(TARGET_FILE, { force: true });
    fs.writeFileSync(TARGET_FILE, '');
    ({ context, page } = await newSignedInContext(browser));
    await addSqliteConnection(
        page,
        SOURCE,
        path.join(DEMO_DIR, 'commerce.sqlite'),
    );
    await addSqliteConnection(page, TARGET, TARGET_FILE);
});

test.afterAll(async () => {
    await context?.close();
    fs.rmSync(TARGET_FILE, { force: true });
});

async function hrefOf(name: string): Promise<string> {
    await page.goto('/connections');
    const href = await page
        .getByRole('link', { name: `Open ${name}`, exact: true })
        .getAttribute('href');
    expect(href).toMatch(/^\/c\/\d+$/);
    return href ?? '';
}

async function openDialog(item: 'Back up…' | 'Restore…') {
    await page.getByRole('button', { name: 'Backup & restore' }).click();
    await page.getByRole('menuitem', { name: item }).click();
    return page.getByRole('dialog');
}

async function tableNames(href: string): Promise<string[]> {
    const response = await page.request.get(`/api${href}/schema`);
    expect(response.ok()).toBe(true);
    const body = await response.json();
    const tables: { name: string }[] = body.snapshot?.tables ?? [];
    return tables.map((t) => t.name).sort();
}

test('backs up a SQLite database and downloads a gzip file', async () => {
    sourcePath = await hrefOf(SOURCE);
    await page.goto(sourcePath);
    const dialog = await openDialog('Back up…');
    await expect(
        dialog.getByRole('heading', { name: /^Back up / }),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Back up' })).toBeEnabled();
    await expectNoA11yViolations(page, { label: 'the backup dialog' });
    await page.screenshot({ path: `${OUT}/backup-dialog.png` });

    await dialog.getByRole('button', { name: 'Back up' }).click();
    const download = dialog.getByRole('link', { name: /^Download / });
    await expect(download).toBeVisible({ timeout: 60_000 });
    await expect(
        dialog.getByText('Backup finished.', { exact: true }),
    ).toBeVisible();
    await expectNoA11yViolations(page, { label: 'the finished backup' });

    const [saved] = await Promise.all([
        page.waitForEvent('download'),
        download.click(),
    ]);
    expect(saved.suggestedFilename()).toMatch(/\.sql\.gz$/);
    backupFile = path.join(OUT, saved.suggestedFilename());
    await saved.saveAs(backupFile);
    const bytes = fs.readFileSync(backupFile);
    expect(bytes.length).toBeGreaterThan(0);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
});

test('restores the backup into an empty database', async () => {
    const targetPath = await hrefOf(TARGET);
    expect(await tableNames(targetPath)).toEqual([]);
    await page.goto(targetPath);

    const dialog = await openDialog('Restore…');
    await expect(
        dialog.getByRole('heading', { name: /^Restore into / }),
    ).toBeVisible();
    await dialog.getByLabel('File').setInputFiles(backupFile);
    const restore = dialog.getByRole('button', { name: 'Restore' });
    await expect(restore).toBeDisabled();
    await expectNoA11yViolations(page, { label: 'the restore dialog' });
    await page.screenshot({ path: `${OUT}/restore-dialog.png` });

    // The dialog asks for the database's name; read it from the label.
    const confirm = dialog.getByLabel(/^Type .* to confirm$/);
    const label =
        (await dialog.locator('label[for]').last().textContent()) ?? '';
    const name = /^Type\s+(.*?)\s+to confirm$/.exec(label.trim())?.[1] ?? '';
    expect(name).not.toBe('');
    await confirm.fill('wrong-name');
    await expect(restore).toBeDisabled();
    await confirm.fill(name);
    await expect(restore).toBeEnabled();
    await restore.click();

    await expect(dialog.getByText(/^Restore finished/)).toBeVisible({
        timeout: 60_000,
    });
    await expectNoA11yViolations(page, { label: 'the finished restore' });

    const original = await tableNames(sourcePath);
    expect(original.length).toBeGreaterThan(0);
    expect(await tableNames(targetPath)).toEqual(original);
});

test.describe('theme screenshots (manual review aid)', () => {
    test.skip(!THEME_SHOTS, 'Set THEME_SHOTS=<dir> to capture them');

    test('captures both dialogs in every theme and mode', async () => {
        test.setTimeout(300_000);
        fs.mkdirSync(THEME_SHOTS!, { recursive: true });
        await page.goto(sourcePath);
        try {
            for (const theme of ['Classic', 'Layered', 'Graphite']) {
                for (const mode of ['light', 'dark'] as const) {
                    await chooseTheme(page, theme);
                    await chooseMode(page, mode);
                    const tag = `${theme.toLowerCase()}-${mode}`;

                    let dialog = await openDialog('Back up…');
                    // The dialog reopens on the backup it finished last.
                    const again = dialog.getByRole('button', {
                        name: 'New backup',
                    });
                    if (await again.isVisible()) await again.click();
                    await expect(
                        dialog.getByRole('button', { name: 'Back up' }),
                    ).toBeEnabled();
                    await settleStyles(page);
                    await page.screenshot({
                        path: `${THEME_SHOTS}/backup-form-${tag}.png`,
                    });
                    await dialog
                        .getByRole('button', { name: 'Back up' })
                        .click();
                    await expect(
                        dialog.getByText('Backup finished.', { exact: true }),
                    ).toBeVisible({ timeout: 60_000 });
                    await settleStyles(page);
                    await page.screenshot({
                        path: `${THEME_SHOTS}/backup-done-${tag}.png`,
                    });
                    await page.keyboard.press('Escape');
                    await expect(dialog).toBeHidden();

                    dialog = await openDialog('Restore…');
                    await dialog.getByLabel('File').setInputFiles(backupFile);
                    await dialog
                        .getByLabel(/^Type .* to confirm$/)
                        .fill('partial');
                    await settleStyles(page);
                    await page.screenshot({
                        path: `${THEME_SHOTS}/restore-form-${tag}.png`,
                    });
                    await page.keyboard.press('Escape');
                    await expect(dialog).toBeHidden();
                }
            }
        } finally {
            await chooseTheme(page, 'Classic');
            await chooseMode(page, 'dark');
        }
    });
});
