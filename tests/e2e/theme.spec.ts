import { test, expect } from './fixtures';

test('change user theme', async ({ page }) => {
	await page.goto('/profile', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Your profile');

	await page.locator('label:has-text("High Contrast")').click();
	await page.getByRole('button', { name: 'Save profile', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.locator('.theme-root[data-theme="high-contrast"]')).toBeVisible();

	// Reset to the default so later test runs / local browsing start from Follow system.
	await page.locator('label:has-text("Follow system")').click();
	await page.getByRole('button', { name: 'Save profile', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.locator('.theme-root[data-theme="system"]')).toBeVisible();
});
