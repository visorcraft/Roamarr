import { test, expect } from './fixtures';

test('add a loyalty program', async ({ page }) => {
	await page.goto('/profile/loyalty/new', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Add loyalty program');

	const programName = `E2E Loyalty ${Date.now()}`;
	const membershipNumber = String(Date.now());
	const form = page.locator('form[action="?/create"]');
	await form.getByLabel('Program name', { exact: true }).fill(programName);
	await form.getByLabel('Membership number', { exact: true }).fill(membershipNumber);
	await form.getByLabel('Balance', { exact: true }).fill('50000');
	await form.getByRole('button', { name: 'Add program', exact: true }).click();
	await page.waitForURL('/profile/loyalty', { waitUntil: 'networkidle' });

	const programRow = page.locator('tbody tr', { hasText: programName });
	await expect(programRow).toBeVisible();
	await expect(programRow.getByText(membershipNumber, { exact: true })).toBeVisible();
});
