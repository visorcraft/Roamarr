import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('add a checklist item to a trip', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}`, { waitUntil: 'networkidle' });
	await page.locator('#trip-tab-prep').click();

	const item = `E2E Item ${Date.now()}`;
	const form = page.locator('form[action="?/addChecklistItem"]');
	await form.locator('input[name="text"]').fill(item);
	await form.locator('button:has-text("Add")').click();
	await page.waitForLoadState('networkidle');

	await expect(page.getByText(item)).toBeVisible();
});
