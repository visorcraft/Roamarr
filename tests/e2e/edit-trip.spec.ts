import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('edit a trip name', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}/edit`, { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Edit trip');

	const newName = `E2E Edited Trip ${Date.now()}`;
	await page.getByLabel('Trip name').fill(newName);
	await page.getByRole('button', { name: 'Save changes', exact: true }).click();
	await page.waitForURL(`/trips/${tripId}`, { waitUntil: 'networkidle' });

	await expect(page.locator('h1')).toContainText(newName);
});
