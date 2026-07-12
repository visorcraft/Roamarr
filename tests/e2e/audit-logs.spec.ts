import { test, expect } from './fixtures';

test('applying filters resets pagination to page 1', async ({ page }) => {
	await page.goto('/audit-logs?page=2', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toHaveText('Audit Logs');

	const response = page.waitForResponse((res) => {
		const url = new URL(res.url());
		return url.pathname === '/api/audit-logs' && url.searchParams.get('action') === 'login' && !url.searchParams.has('page');
	});
	await page.getByLabel('Action', { exact: true }).fill('login');
	await response;
});

test('resetting filters returns to page 1', async ({ page }) => {
	await page.goto('/audit-logs?page=2&action=login', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toHaveText('Audit Logs');

	const response = page.waitForResponse((res) => {
		const url = new URL(res.url());
		return url.pathname === '/api/audit-logs' && !url.searchParams.has('action') && !url.searchParams.has('page');
	});
	await page.getByLabel('Action', { exact: true }).fill('');
	await response;
});
