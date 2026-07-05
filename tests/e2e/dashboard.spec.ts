import { test, expect } from './fixtures';

test('dashboard loads for authenticated user', async ({ page }) => {
	await page.goto('/', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Welcome back');
	await expect(page.getByRole('link', { name: 'Trips', exact: true })).toBeVisible();
});
