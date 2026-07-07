import { test, expect } from './fixtures';

test('applying filters resets pagination to page 1', async ({ page }) => {
	await page.goto('/audit-logs?page=2', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Audit log');

	await page.getByLabel('Action', { exact: true }).fill('login');
	await page.getByRole('button', { name: 'Filter', exact: true }).click();

	await page.waitForURL((url) => !url.searchParams.has('page'), { waitUntil: 'networkidle' });
	expect(page.url()).toContain('action=login');
	expect(page.url()).not.toContain('page=2');
});

test('resetting filters returns to page 1', async ({ page }) => {
	await page.goto('/audit-logs?page=2&action=login', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Audit log');

	await page.getByRole('button', { name: 'Reset', exact: true }).click();

	await page.waitForURL('/audit-logs', { waitUntil: 'networkidle' });
	expect(page.url()).not.toContain('page=2');
	expect(page.url()).not.toContain('action=login');
});
