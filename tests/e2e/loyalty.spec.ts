import { test, expect } from './fixtures';

test('add a loyalty program', async ({ page }) => {
	await page.goto('/profile/loyalty', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Loyalty programs');

	const programName = `E2E Loyalty ${Date.now()}`;
	const membershipNumber = String(Date.now());
	const form = page.locator('section:has-text("Add program")');
	await form.getByLabel('Program', { exact: true }).fill(programName);
	await form.getByLabel('Membership #', { exact: true }).fill(membershipNumber);
	await form.getByLabel('Balance', { exact: true }).fill('50000');
	await form.getByRole('button', { name: 'Add program', exact: true }).click();
	await page.waitForLoadState('networkidle');

	const programRow = page.locator('li.list-item', { hasText: programName });
	await expect(programRow).toBeVisible();
	await expect(programRow.locator('span.meta-strong', { hasText: membershipNumber })).toBeVisible();
});
