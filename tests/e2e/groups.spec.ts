import { test, expect } from './fixtures';

test('create a group', async ({ page }) => {
	await page.goto('/groups', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Groups');

	const name = `E2E Group ${Date.now()}`;
	await page.getByRole('link', { name: 'Create group', exact: true }).click();
	await page.waitForURL('/groups/new');

	await page.getByLabel('Group name', { exact: true }).fill(name);
	await page.getByRole('button', { name: 'Create group', exact: true }).click();
	await page.waitForURL('/groups');

	const row = page.locator('table tbody tr', { hasText: name });
	await expect(row).toBeVisible();
	await expect(row.getByText('0 members')).toBeVisible();
});
