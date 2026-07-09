import { test, expect } from './fixtures';

test('add a fare provider account', async ({ page }) => {
	await page.goto('/fare-providers', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Fare-watch providers');

	const label = `E2E Provider ${Date.now()}`;
	await page.getByRole('link', { name: 'Add account', exact: true }).click();
	await page.waitForURL('/fare-providers/new', { waitUntil: 'networkidle' });

	await page.getByLabel('Provider', { exact: true }).selectOption('stub');
	await page.getByLabel('Label', { exact: true }).fill(label);
	await page.getByLabel('API key', { exact: true }).fill('e2e-test-key');
	await page.getByRole('button', { name: 'Add account', exact: true }).click();
	await page.waitForURL('/fare-providers', { waitUntil: 'networkidle' });

	const row = page.locator('tbody tr', { hasText: label });
	await expect(row).toBeVisible();
	await expect(row.getByLabel('Actions')).toBeVisible();
});

test('rejects a fare provider account with an empty label', async ({ page }) => {
	await page.goto('/fare-providers/new', { waitUntil: 'networkidle' });

	await page.getByLabel('Provider', { exact: true }).selectOption('stub');
	await page.getByLabel('Label', { exact: true }).fill('');
	await page.getByRole('button', { name: 'Add account', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.locator('.notice.notice-error')).toContainText('Label is required');
});
