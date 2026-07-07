import { test, expect } from './fixtures';

test('create a user from admin settings', async ({ page }) => {
	await page.goto('/users', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Users');

	await page.getByRole('link', { name: 'Create user', exact: true }).click();
	await page.waitForURL('/users/new', { waitUntil: 'networkidle' });

	const email = `e2e-user-${Date.now()}@roamarr.test`;
	const name = `E2E User ${Date.now()}`;
	await page.getByLabel('Display name', { exact: true }).fill(name);
	await page.getByLabel('Email', { exact: true }).fill(email);
	await page.getByLabel('Role', { exact: true }).selectOption('user');

	await page.getByRole('button', { name: 'Create account', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.getByText(`Created account for ${email}.`)).toBeVisible();

	// Return to the GridTable list and verify the new user rendered.
	await page.getByRole('link', { name: 'Back to users' }).click();
	await page.waitForURL('/users', { waitUntil: 'networkidle' });
	await expect(page.getByText(name)).toBeVisible();
	await expect(page.getByText(email)).toBeVisible();
});

test('rejects creating a user with an invalid email', async ({ page }) => {
	await page.goto('/users/new', { waitUntil: 'networkidle' });

	await page.getByLabel('Display name', { exact: true }).fill('Invalid Email User');
	const emailInput = page.getByLabel('Email', { exact: true });
	await emailInput.fill('notanemail');
	// Bypass the browser's built-in email validation so the server validator runs.
	await emailInput.evaluate((el: HTMLInputElement) => (el.type = 'text'));
	await page.getByLabel('Role', { exact: true }).selectOption('user');

	await page.getByRole('button', { name: 'Create account', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.locator('.notice.notice-error')).toContainText('A valid email is required');
});
