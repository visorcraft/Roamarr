import { test, expect } from './fixtures';

test('update display name', async ({ page }) => {
	await page.goto('/profile', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Your profile');

	const newName = `E2E User ${Date.now()}`;
	await page.getByLabel('Display name').fill(newName);
	await page.getByRole('button', { name: 'Save profile', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.getByLabel('Display name')).toHaveValue(newName);
});
