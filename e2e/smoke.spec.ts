import { expect, test } from '@playwright/test';

test('app boots and serves a page', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('body')).toBeVisible();
});
