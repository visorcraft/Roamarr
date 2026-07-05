import { test, expect } from './fixtures';

test('add a payment card', async ({ page }) => {
	await page.goto('/cards', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Cards');

	const nickname = `E2E Card ${Date.now()}`;
	const form = page.locator('section:has-text("Add card")');
	await form.getByLabel('Nickname', { exact: true }).fill(nickname);
	await form.getByLabel('Network', { exact: true }).selectOption('visa');
	await form.getByLabel('Last 4', { exact: true }).fill('4242');
	await form.getByRole('button', { name: 'Add card', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.getByText(nickname)).toBeVisible();
	await expect(page.getByText('…4242')).toBeVisible();
});
