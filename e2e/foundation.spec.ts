import { expect, test } from '@playwright/test';
import path from 'node:path';
import { setupCode } from './support/auth';

test('setup → add SQLite connection → test → explore schema list', async ({
    page,
}) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup$/);

    await page.getByLabel('Setup code').fill(setupCode());
    await page.getByLabel('Name', { exact: true }).fill('Admin');
    await page.getByLabel('Email').fill('admin@example.com');
    await page
        .getByLabel('Password', { exact: true })
        .fill('correct-horse-battery');
    await page.getByLabel('Confirm password').fill('correct-horse-battery');
    await page.getByRole('button', { name: 'Create administrator' }).click();
    await expect(page).toHaveURL(/\/connections$/);

    await page.getByRole('link', { name: 'New connection' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Demo shop');
    await page.getByLabel('Engine').selectOption('sqlite');
    await page
        .getByLabel('SQLite file path')
        .fill(path.resolve('storage/app/demo/commerce.sqlite'));
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByRole('status')).toContainText('Connected');
    await page.getByRole('button', { name: 'Add connection' }).click();

    await page
        .getByRole('link', { name: 'Open Demo shop', exact: true })
        .click();
    // The table sidebar lists every table beside the universe (which shows the inferred legend).
    const tree = page.getByRole('tree', { name: 'Tables' });
    await expect(
        tree.getByRole('treeitem', { name: /^products,/ }),
    ).toBeVisible();
    await expect(page.getByText(/inferred/i).first()).toBeVisible();
    await page
        .getByRole('searchbox', { name: 'Search tables' })
        .fill('régions');
    await expect(
        tree.getByRole('treeitem', { name: /^régions,/ }),
    ).toBeVisible();
    await expect(
        tree.getByRole('treeitem', { name: /^products,/ }),
    ).toHaveCount(0);
});
