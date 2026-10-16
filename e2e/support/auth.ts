import { expect, type Page } from '@playwright/test';

export const ADMIN = {
    name: 'Admin',
    email: 'admin@example.com',
    password: 'correct-horse-battery',
};

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
