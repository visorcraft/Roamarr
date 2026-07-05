import { test, expect } from './fixtures';

test('add an insurance policy', async ({ page }) => {
	await page.goto('/insurance', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Insurance policies');

	const provider = `E2E Insurance ${Date.now()}`;
	const form = page.locator('section:has-text("Add policy")');
	await form.getByLabel('Provider', { exact: true }).fill(provider);
	await form.getByLabel('Policy #', { exact: true }).fill('POL-12345');
	await form.getByLabel('Coverage summary', { exact: true }).fill('Trip cancellation');
	await form.getByLabel('Coverage (cents)', { exact: true }).fill('100000');
	await form.getByLabel('Start date', { exact: true }).fill('2030-01-01');
	await form.getByLabel('End date', { exact: true }).fill('2030-12-31');
	await form.getByRole('button', { name: 'Add policy', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.getByText(provider)).toBeVisible();
	await expect(page.getByText('POL-12345')).toBeVisible();
});
