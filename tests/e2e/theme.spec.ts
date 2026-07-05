import { test, expect } from './fixtures';

test('change user theme', async ({ page }) => {
	await page.goto('/profile', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Your profile');

	await page.locator('label:has-text("High Contrast")').click();
	await page.getByRole('button', { name: 'Save profile', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.locator('.theme-root[data-theme="high-contrast"]')).toBeVisible();
});
