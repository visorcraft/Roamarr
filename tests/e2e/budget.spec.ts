import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('set a trip budget cap', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}`, { waitUntil: 'load' });

	// Tabs are hydrated client-side; retry the click until the tab renders.
	const form = page.locator('form[action="?/setBudget"]').first();
	await expect(async () => {
		await page.locator('#trip-tab-money').click();
		await expect(form).toBeVisible({ timeout: 2000 });
	}).toPass();
	await form.locator('input[name="amount"]').fill('2500');
	await form.locator('button:has-text("Set cap")').click();
	await page.waitForLoadState('load');
	await expect(async () => {
		await page.locator('#trip-tab-money').click();
		await expect(page.getByText('USD 2500.00 remaining')).toBeVisible({ timeout: 2000 });
	}).toPass();
});
