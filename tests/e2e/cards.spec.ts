import { test, expect } from './fixtures';

test('add a payment card', async ({ page }) => {
	const nickname = `E2E Card ${Date.now()}`;
	const last4 = String(Date.now()).slice(-4);

	await page.goto('/cards', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Cards');
	await page.getByRole('link', { name: 'Add card' }).click();
	await page.waitForURL('/cards/new');

	const form = page.locator('section.card');
	await form.getByLabel('Nickname', { exact: true }).fill(nickname);
	await form.getByLabel('Network', { exact: true }).selectOption('visa');
	await form.getByLabel('Last 4', { exact: true }).fill(last4);
	await form.getByRole('button', { name: 'Add card', exact: true }).click();
	await page.waitForURL('/cards');

	await expect(page.locator('td', { hasText: nickname })).toBeVisible();
	await expect(page.locator('td', { hasText: `…${last4}` })).toBeVisible();
});
