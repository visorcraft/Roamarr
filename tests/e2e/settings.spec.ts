import { test, expect } from './fixtures';

test('update instance name', async ({ page }) => {
	await page.goto('/general', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('General');

	const newName = `Roamarr E2E ${Date.now()}`;
	await page.getByLabel('Instance name').fill(newName);
	await page.getByRole('button', { name: 'Save general settings', exact: true }).click();

	// The page should re-render with the saved value.
	await expect(page.locator('input#instanceName')).toHaveValue(newName);
});
