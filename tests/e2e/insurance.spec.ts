import { test, expect } from './fixtures';

test('add an insurance policy', async ({ page }) => {
	await page.goto('/insurance/new', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Add policy');

	const provider = `E2E Insurance ${Date.now()}`;
	const policyNumber = `POL-${Date.now()}`;
	const form = page.locator('form[action="?/create"]');
	await form.getByLabel('Provider', { exact: true }).fill(provider);
	await form.getByLabel('Policy number', { exact: true }).fill(policyNumber);
	await form.getByLabel('Coverage summary', { exact: true }).fill('Trip cancellation');
	await form.getByLabel('Coverage amount (cents)', { exact: true }).fill('100000');
	await form.getByLabel('Start date', { exact: true }).fill('2030-01-01');
	await form.getByLabel('End date', { exact: true }).fill('2030-12-31');
	await form.getByRole('button', { name: 'Add policy', exact: true }).click();
	await page.waitForURL('/insurance', { waitUntil: 'networkidle' });

	const policyRow = page.locator('tbody tr', { hasText: provider });
	await expect(policyRow).toBeVisible();
	await expect(policyRow.getByText(policyNumber)).toBeVisible();
});
