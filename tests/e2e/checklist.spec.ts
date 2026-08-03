import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('add a checklist item to a trip', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}`, { waitUntil: 'load' });

	// Tabs are hydrated client-side; retry the click until the tab renders.
	const item = `E2E Item ${Date.now()}`;
	const form = page.locator('form[action="?/addChecklistItem"]');
	await expect(async () => {
		await page.locator('#trip-tab-prep').click();
		await expect(form).toBeVisible({ timeout: 2000 });
	}).toPass();
	await form.locator('input[name="text"]').fill(item);
	await form.locator('button:has-text("Add")').click();
	await page.waitForLoadState('load');
	await expect(async () => {
		await page.locator('#trip-tab-prep').click();
		await expect(page.getByText(item)).toBeVisible({ timeout: 2000 });
	}).toPass();
});
