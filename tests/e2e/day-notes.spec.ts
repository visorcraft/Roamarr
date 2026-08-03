import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('add, render, and delete a day note on a trip', async ({ page }) => {
	const { tripId } = await createTrip(page);

	// Day cards only render for days that have segments, so seed one day.
	await page.goto(`/trips/${tripId}/segments/new`, { waitUntil: 'networkidle' });
	await page.getByRole('link', { name: 'Note', exact: true }).click();
	await page.waitForURL(`/trips/${tripId}/segments/new/note`, { waitUntil: 'networkidle' });
	await page.getByLabel('Note title').fill(`E2E Day Note Anchor ${Date.now()}`);
	await page.getByLabel('Note', { exact: true }).fill('Segment so the day card exists.');
	await page.getByLabel('Date', { exact: true }).fill('2030-06-02');
	await page.getByLabel('Timezone').selectOption('UTC');
	await page.click('button:has-text("Save")');
	// No networkidle here: the trip page opens the /api/events SSE stream,
	// which keeps the network busy indefinitely.
	await page.waitForURL(new RegExp(`/trips/${tripId}`));

	const day = page.locator('section[aria-label$="itinerary plans"]').first();
	await expect(day).toBeVisible();

	// Add a day note. The trip page hydrates after load, so retry the click
	// until the client-side editor actually opens.
	const addNoteButton = day.getByRole('button', { name: 'Add day note' });
	const editor = day.locator('.trip-modern-day-note-editor');
	await expect(async () => {
		await addNoteButton.click();
		await expect(editor).toBeVisible({ timeout: 2000 });
	}).toPass();
	await editor.getByPlaceholder('Add a note for this day…').fill('Museum opens at 9, book ahead.');
	await editor.getByRole('button', { name: 'Save note' }).click();

	const note = day.locator('.trip-modern-day-note');
	await expect(note).toContainText('Museum opens at 9, book ahead.');

	// Delete it through the inline confirmation.
	await note.getByRole('button', { name: 'Edit day note' }).click();
	await editor.getByRole('button', { name: 'Delete note' }).click();
	await editor.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(day.locator('.trip-modern-day-note')).toHaveCount(0);
	await expect(day.getByRole('button', { name: 'Add day note' })).toBeVisible();
});
