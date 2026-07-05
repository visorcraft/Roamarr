import { test, expect } from './fixtures';
import { createTrip } from './helpers';
import { readFile } from 'node:fs/promises';

test('add an expense to a trip', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}`, { waitUntil: 'networkidle' });
	await page.locator('#trip-tab-money').click();

	const description = `E2E Expense ${Date.now()}`;
	const form = page.locator('form[action="?/addExpense"]');
	await form.locator('input[name="description"]').fill(description);
	await form.locator('input[name="amount"]').fill('123.45');
	await form.locator('input[name="currency"]').fill('USD');
	await form.locator('select[name="category"]').selectOption('activities');

	await form.locator('button:has-text("Add expense")').click();
	await page.waitForLoadState('networkidle');

	const expenseRow = page.locator('[data-testid="expense-list"] li', { hasText: description });
	await expect(expenseRow).toBeVisible();
	await expect(expenseRow.getByText('USD 123.45')).toBeVisible();
});

test('expense receipt uploads and downloads intact', async ({ page }) => {
	const { tripId } = await createTrip(page);
	await page.goto(`/trips/${tripId}`, { waitUntil: 'networkidle' });
	await page.locator('#trip-tab-money').click();

	const description = `E2E Receipt Expense ${Date.now()}`;
	const expenseForm = page.locator('form[action="?/addExpense"]');
	await expenseForm.locator('input[name="description"]').fill(description);
	await expenseForm.locator('input[name="amount"]').fill('50');
	await expenseForm.locator('button:has-text("Add expense")').click();
	await page.waitForLoadState('networkidle');

	const pdfContent = '%PDF-1.4 test receipt content';
	const buffer = Buffer.from(pdfContent);
	await page.locator('form[action="?/addAttachment"] input[type="file"][name="file"]').setInputFiles({
		name: 'receipt.pdf',
		mimeType: 'application/pdf',
		buffer
	});
	await page.locator('form[action="?/addAttachment"]').getByRole('button', { name: 'Upload' }).click();
	await page.waitForLoadState('networkidle');

	const expenseRow = page.locator('[data-testid="expense-list"] li', { hasText: description });
	const receiptLink = expenseRow.getByRole('link', { name: 'receipt.pdf' });
	await expect(receiptLink).toBeVisible();
	const downloadPromise = page.waitForEvent('download');
	await receiptLink.click();
	const download = await downloadPromise;
	const downloaded = await readFile(await download.path());
	expect(downloaded.toString('utf8')).toBe(pdfContent);
});
