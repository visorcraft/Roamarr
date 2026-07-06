import { test, expect } from './fixtures';

test('create a user from admin settings', async ({ page }) => {
	await page.goto('/users', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Users');

	await page.getByRole('button', { name: 'Create user', exact: true }).click();

	const email = `e2e-user-${Date.now()}@roamarr.test`;
	const name = `E2E User ${Date.now()}`;
	const form = page.locator('section:has-text("Create user") form[action="?/create"]');
	await form.getByLabel('Display name', { exact: true }).fill(name);
	await form.getByLabel('Email', { exact: true }).fill(email);
	await form.getByLabel('Role', { exact: true }).selectOption('user');

	await form.getByRole('button', { name: 'Create account', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.getByText(`Created account for ${email}.`)).toBeVisible();
	await expect(page.getByText(name)).toBeVisible();
});
