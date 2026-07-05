import { test, expect } from './fixtures';

test('create a group', async ({ page }) => {
	await page.goto('/groups', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Groups');

	const name = `E2E Group ${Date.now()}`;
	const form = page.locator('section:has-text("Create a group")');
	await form.getByLabel('Group name', { exact: true }).fill(name);
	await form.getByRole('button', { name: 'Create group', exact: true }).click();
	await page.waitForLoadState('networkidle');

	const groupCard = page.locator('section.card', { hasText: name });
	await expect(groupCard).toBeVisible();
	await expect(groupCard.getByText('0 members')).toBeVisible();
});
