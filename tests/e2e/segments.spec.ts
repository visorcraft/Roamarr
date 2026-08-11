import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('add a note segment to a trip', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}/segments/new`, { waitUntil: 'networkidle' });
	await page.getByRole('link', { name: 'Note', exact: true }).click();
	await page.waitForURL(`/trips/${tripId}/segments/new/note`, { waitUntil: 'networkidle' });

	const title = `E2E Note ${Date.now()}`;
	await page.getByLabel('Note title').fill(title);
	await page.getByLabel('Note', { exact: true }).fill('Created by the end-to-end test suite. '.repeat(100));
	await page.getByLabel('Date', { exact: true }).fill('2030-06-02');
	await page.getByLabel('Timezone').selectOption('UTC');

	await page.click('button:has-text("Save")');
	await page.waitForURL(`/trips/${tripId}`, { waitUntil: 'load' });

	const segment = page.locator('.trip-modern-segment', { hasText: title });
	await expect(segment).toBeVisible();

	// The card click needs client-side hydration; retry until the dialog opens.
	const details = page.getByRole('dialog', { name: 'Selected segment details' });
	await expect(async () => {
		if (!(await details.isVisible().catch(() => false))) await segment.click();
		await expect(details).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 15_000 });
	await details.getByRole('button', { name: 'Notes' }).click();
	const pageScroll = await page.evaluate(() => window.scrollY);
	const metrics = await details.evaluate((element) => ({
		overflowY: getComputedStyle(element).overflowY,
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight
	}));
	expect(metrics.overflowY).toBe('auto');
	expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
	await details.evaluate((element) => element.scrollTo(0, element.scrollHeight));
	expect(await details.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
	await details.getByRole('button', { name: 'Close selected segment' }).click();

	await page.setViewportSize({ width: 390, height: 844 });
	await segment.click();
	await expect(details).toBeVisible();
	expect(await details.boundingBox()).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
	await details.getByRole('button', { name: 'Close selected segment' }).click();
	await expect(details).toBeHidden();
});
