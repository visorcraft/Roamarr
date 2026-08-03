import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('add a document link to a trip', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}`, { waitUntil: 'load' });

	// Tabs are hydrated client-side; retry the click until the tab renders.
	const label = `E2E Link ${Date.now()}`;
	const form = page.locator('form[action="?/addDocumentLink"]');
	await expect(async () => {
		await page.locator('#trip-tab-documents').click();
		await expect(form).toBeVisible({ timeout: 2000 });
	}).toPass();
	await form.locator('input[name="label"]').fill(label);
	await form.locator('input[name="url"]').fill('https://roamarr.test/confirmation');
	await form.locator('button:has-text("Add link")').click();
	await page.waitForLoadState('load');
	await expect(async () => {
		await page.locator('#trip-tab-documents').click();
		await expect(page.getByText(label)).toBeVisible({ timeout: 2000 });
	}).toPass();
});
