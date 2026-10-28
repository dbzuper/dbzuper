import {
    expect,
    type Browser,
    type BrowserContext,
    type Page,
} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const ADMIN = {
    name: 'Admin',
    email: 'admin@example.com',
    password: 'correct-horse-battery',
};

/** The e2e server keeps its setup code here (DBZUPER_SETUP_CODE_PATH in playwright.config.ts). */
export const SETUP_CODE = path.resolve(
    'storage/framework/testing/e2e-setup-code',
);

/** The code the setup screen asks for; the screen issues it when it is shown. */
export function setupCode(): string {
    return fs.readFileSync(SETUP_CODE, 'utf8').trim();
}

/**
 * Signs in, creating the admin on a fresh install. `beforeSignIn` runs on the login or setup screen
 * before the form is filled (used for checks that need the signed-out page, without a second login).
 */
export async function ensureSignedIn(
    page: Page,
    beforeSignIn?: (pathname: string) => Promise<void>,
): Promise<void> {
    await page.goto('/');
    const pathname = new URL(page.url()).pathname;
    if (beforeSignIn && (pathname === '/setup' || pathname === '/login'))
        await beforeSignIn(pathname);
    if (pathname === '/setup') {
        await page.getByLabel('Setup code').fill(setupCode());
        await page.getByLabel('Name', { exact: true }).fill(ADMIN.name);
        await page.getByLabel('Email').fill(ADMIN.email);
        await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
        await page.getByLabel('Confirm password').fill(ADMIN.password);
        await page
            .getByRole('button', { name: 'Create administrator' })
            .click();
    } else if (pathname === '/login') {
        await page.getByLabel('Email').fill(ADMIN.email);
        await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
        await page.getByRole('button', { name: 'Log in' }).click();
    }
    await expect(page).toHaveURL(/\/connections$/);
}

/** The signed-in session specs share; global-setup removes it, since it starts a fresh app database. */
export const AUTH_STATE = path.resolve(
    'storage/framework/testing/e2e-auth.json',
);

/**
 * A context and page signed in as the admin, reusing the session an earlier spec saved: Fortify allows five logins a
 * minute and every spec signs in as the same user. Signs in (and saves the session) when there is none or it expired.
 */
export async function newSignedInContext(
    browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext(
        fs.existsSync(AUTH_STATE) ? { storageState: AUTH_STATE } : {},
    );
    const page = await context.newPage();
    await ensureSignedIn(page);
    await context.storageState({ path: AUTH_STATE });
    return { context, page };
}

export async function addSqliteConnection(
    page: Page,
    name: string,
    file: string,
): Promise<void> {
    await page.goto('/connections/create');
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Engine').selectOption('sqlite');
    await page.getByLabel('SQLite file path').fill(file);
    await page.getByRole('button', { name: 'Add connection' }).click();
    await expect(page).toHaveURL(/\/connections$/);
}
