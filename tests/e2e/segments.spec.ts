import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('add a note segment to a trip', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}/segments/new`, { waitUntil: 'networkidle' });
	await page.getByRole('link', { name: 'Note', exact: true }).click();
	await page.waitForURL(`/trips/${tripId}/segments/new/note`, { waitUntil: 'networkidle' });

	const title = `E2E Note ${Date.now()}`;
	await page.getByLabel('Note title').fill(title);
	await page.getByLabel('Note', { exact: true }).fill('Created by the end-to-end test suite.');
	await page.getByLabel('Date', { exact: true }).fill('2030-06-02');
	await page.getByLabel('Timezone').selectOption('UTC');

	await page.click('button:has-text("Save")');
	await page.waitForURL(`/trips/${tripId}`, { waitUntil: 'networkidle' });

	const segment = page.locator('.trip-modern-segment', { hasText: title });
	await expect(segment).toBeVisible();

	await page.setViewportSize({ width: 390, height: 844 });
	await segment.click();
	const details = page.getByRole('dialog', { name: 'Selected segment details' });
	await expect(details).toBeVisible();
	expect(await details.boundingBox()).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
	await details.getByRole('button', { name: 'Close selected segment' }).click();
	await expect(details).toBeHidden();
});
