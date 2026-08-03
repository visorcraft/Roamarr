import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('add a journal entry to a trip', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}`, { waitUntil: 'load' });

	// Tabs are hydrated client-side; retry the click until the tab renders.
	const title = `E2E Journal ${Date.now()}`;
	const form = page.locator('form[action="?/addJournalEntry"]');
	await expect(async () => {
		await page.locator('#trip-tab-notes').click();
		await expect(form).toBeVisible({ timeout: 2000 });
	}).toPass();
	await form.locator('input[name="title"]').fill(title);
	await form.locator('input[name="entryDate"]').fill('2030-06-03');
	await form.locator('textarea[name="body"]').fill('A journal entry created by the e2e suite.');
	await form.locator('button:has-text("Add journal entry")').click();
	await page.waitForLoadState('load');
	await expect(async () => {
		await page.locator('#trip-tab-notes').click();
		await expect(page.getByText(title)).toBeVisible({ timeout: 2000 });
	}).toPass();
});
