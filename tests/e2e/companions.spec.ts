import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('add a companion to a trip', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}`, { waitUntil: 'networkidle' });
	await page.locator('#trip-tab-people').click();

	const name = `E2E Companion ${Date.now()}`;
	const form = page.locator('form[action="?/addCompanion"]');
	await form.locator('input[name="name"]').fill(name);
	await form.locator('select[name="category"]').selectOption('adult');
	await form.locator('button:has-text("Add")').click();
	await page.waitForLoadState('networkidle');
	await page.locator('#trip-tab-people').click();

	await expect(page.getByText(name)).toBeVisible();
});
