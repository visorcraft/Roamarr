import { test, expect } from './fixtures';

test('add a payment card', async ({ page }) => {
	await page.goto('/cards', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Cards');

	const nickname = `E2E Card ${Date.now()}`;
	const last4 = String(Date.now()).slice(-4);
	const form = page.locator('section:has-text("Add card")');
	await form.getByLabel('Nickname', { exact: true }).fill(nickname);
	await form.getByLabel('Network', { exact: true }).selectOption('visa');
	await form.getByLabel('Last 4', { exact: true }).fill(last4);
	await form.getByRole('button', { name: 'Add card', exact: true }).click();
	await page.waitForLoadState('networkidle');

	const card = page.locator('section.card', { hasText: nickname });
	await expect(card).toBeVisible();
	await expect(card.getByText(`…${last4}`)).toBeVisible();
});
