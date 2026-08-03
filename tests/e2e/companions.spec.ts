import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('add a companion to a trip', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}`, { waitUntil: 'load' });

	// Tabs are hydrated client-side; retry the click until the tab renders.
	const name = `E2E Companion ${Date.now()}`;
	const form = page.locator('form[action="?/addCompanion"]');
	await expect(async () => {
		await page.locator('#trip-tab-people').click();
		await expect(form).toBeVisible({ timeout: 2000 });
	}).toPass();
	await form.locator('input[name="name"]').fill(name);
	await form.locator('select[name="category"]').selectOption('adult');
	await form.locator('button:has-text("Add")').click();
	await page.waitForLoadState('load');
	await expect(async () => {
		await page.locator('#trip-tab-people').click();
		await expect(page.getByText(name)).toBeVisible({ timeout: 2000 });
	}).toPass();
});
