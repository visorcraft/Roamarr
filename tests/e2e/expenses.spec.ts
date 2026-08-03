import { test, expect } from './fixtures';
import { createTrip } from './helpers';
import { readFile } from 'node:fs/promises';

test('add an expense to a trip', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}`, { waitUntil: 'load' });

	// Tabs are hydrated client-side; retry the click until the tab renders.
	const description = `E2E Expense ${Date.now()}`;
	const form = page.locator('form[action="?/addExpense"]');
	await expect(async () => {
		await page.locator('#trip-tab-money').click();
		await expect(form).toBeVisible({ timeout: 2000 });
	}).toPass();
	await form.locator('input[name="description"]').fill(description);
	await form.locator('input[name="amount"]').fill('123.45');
	await form.locator('input[name="currency"]').fill('USD');
	await form.locator('select[name="category"]').selectOption('activities');

	await form.locator('button:has-text("Add expense")').click();
	await page.waitForLoadState('load');

	const expenseRow = page.locator('[data-testid="expense-list"] li', { hasText: description });
	await expect(async () => {
		await page.locator('#trip-tab-money').click();
		await expect(expenseRow).toBeVisible({ timeout: 2000 });
	}).toPass();
	await expect(expenseRow.getByText('USD 123.45')).toBeVisible();
});

test('expense receipt uploads and downloads intact', async ({ page }) => {
	const { tripId } = await createTrip(page);
	await page.goto(`/trips/${tripId}`, { waitUntil: 'load' });

	// Tabs are hydrated client-side; retry the click until the tab renders.
	const description = `E2E Receipt Expense ${Date.now()}`;
	const expenseForm = page.locator('form[action="?/addExpense"]');
	await expect(async () => {
		await page.locator('#trip-tab-money').click();
		await expect(expenseForm).toBeVisible({ timeout: 2000 });
	}).toPass();
	await expenseForm.locator('input[name="description"]').fill(description);
	await expenseForm.locator('input[name="amount"]').fill('50');
	await expenseForm.locator('button:has-text("Add expense")').click();
	await page.waitForLoadState('load');

	const attachmentForm = page.locator('form[action="?/addAttachment"]');
	await expect(async () => {
		await page.locator('#trip-tab-money').click();
		await expect(attachmentForm).toBeVisible({ timeout: 2000 });
	}).toPass();

	const pdfContent = '%PDF-1.4 test receipt content';
	const buffer = Buffer.from(pdfContent);
	await attachmentForm.locator('input[type="file"][name="file"]').setInputFiles({
		name: 'receipt.pdf',
		mimeType: 'application/pdf',
		buffer
	});
	await attachmentForm.getByRole('button', { name: 'Upload' }).click();
	await page.waitForLoadState('load');

	const expenseRow = page.locator('[data-testid="expense-list"] li', { hasText: description });
	const receiptLink = expenseRow.getByRole('link', { name: 'receipt.pdf' });
	await expect(async () => {
		await page.locator('#trip-tab-money').click();
		await expect(receiptLink).toBeVisible({ timeout: 2000 });
	}).toPass();
	const downloadPromise = page.waitForEvent('download');
	await receiptLink.click();
	const download = await downloadPromise;
	const downloaded = await readFile(await download.path());
	expect(downloaded.toString('utf8')).toBe(pdfContent);
});
