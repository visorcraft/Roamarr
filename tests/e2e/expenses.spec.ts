import { test, expect } from './fixtures';
import { createTrip } from './helpers';

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

	await expect(page.getByText(description)).toBeVisible();
	await expect(page.getByRole('listitem').getByText('USD 123.45')).toBeVisible();
});
