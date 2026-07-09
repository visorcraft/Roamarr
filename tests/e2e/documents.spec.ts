import { test, expect } from './fixtures';

test('add a travel document', async ({ page }) => {
	await page.goto('/profile/documents/new', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Add travel document');

	const number = `E2E${Date.now()}`;
	const authority = `E2E Authority ${Date.now()}`;
	const form = page.locator('form[action="?/create"]');
	await form.getByLabel('Type', { exact: true }).selectOption('passport');
	await form.getByLabel('Document number', { exact: true }).fill(number);
	await form.getByLabel('Issuing authority', { exact: true }).fill(authority);
	await form.getByLabel('Expires on', { exact: true }).fill('2035-01-01');
	await form.getByRole('button', { name: 'Add document', exact: true }).click();
	await page.waitForURL('/profile/documents', { waitUntil: 'networkidle' });

	const documentRow = page.locator('tbody tr', { hasText: number });
	await expect(documentRow).toBeVisible();
	await expect(documentRow.getByText(authority)).toBeVisible();
});
