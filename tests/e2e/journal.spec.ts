import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('add a journal entry to a trip', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}`, { waitUntil: 'networkidle' });
	await page.locator('#trip-tab-notes').click();

	const title = `E2E Journal ${Date.now()}`;
	const form = page.locator('form[action="?/addJournalEntry"]');
	await form.locator('input[name="title"]').fill(title);
	await form.locator('input[name="entryDate"]').fill('2030-06-03');
	await form.locator('textarea[name="body"]').fill('A journal entry created by the e2e suite.');
	await form.locator('button:has-text("Add journal entry")').click();
	await page.waitForLoadState('networkidle');

	await expect(page.getByText(title)).toBeVisible();
});
