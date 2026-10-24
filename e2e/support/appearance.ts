import { expect, type Page } from '@playwright/test';

const MODE_LABELS = { light: 'Light', dark: 'Dark', system: 'System' };

/** Opens the header's Appearance menu (if closed) and returns it. */
export async function openAppearanceMenu(page: Page) {
    const menu = page.getByRole('dialog').filter({
        has: page.getByRole('radiogroup', { name: 'Mode' }),
    });
    if ((await menu.count()) === 0)
        await page.getByRole('button', { name: 'Appearance' }).first().click();
    await expect(menu).toBeVisible();
    return menu;
}

/** Closes the Appearance menu with Escape, as a keyboard user would. */
export async function closeAppearanceMenu(page: Page): Promise<void> {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('radiogroup', { name: 'Mode' })).toHaveCount(0);
}

/** Picks a light/dark mode in the real Appearance menu and closes it again. */
export async function chooseMode(
    page: Page,
    mode: keyof typeof MODE_LABELS,
): Promise<void> {
    const menu = await openAppearanceMenu(page);
    const radio = menu
        .getByRole('radiogroup', { name: 'Mode' })
        .getByRole('radio', { name: MODE_LABELS[mode] });
    await radio.click();
    await expect(radio).toHaveAttribute('aria-checked', 'true');
    await closeAppearanceMenu(page);
}
