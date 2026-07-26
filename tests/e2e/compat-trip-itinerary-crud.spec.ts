/**
 * Compatibility e2e: full trip + itinerary CRUD against a real MongrelDB
 * (tip engine + production DB layout). Uses qa-compat-* names only.
 *
 * Segment edit is in-page (trip detail panel), not a separate /edit URL.
 */
import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test.describe.configure({ mode: 'serial' });

test('qa-compat trip and itinerary create/edit/delete', async ({ page }) => {
	test.setTimeout(180_000);
	const stamp = Date.now();
	const tripName = `qa-compat-trip-${stamp}`;
	const segmentTitle = `qa-compat-note-${stamp}`;
	const editedSegmentTitle = `qa-compat-note-edited-${stamp}`;
	const editedTripName = `qa-compat-trip-edited-${stamp}`;

	// Baseline: pre-existing Bangkok trip from a production DB copy.
	// Fresh e2e volumes (prepare.mjs down -v) have no such row — skip rather than fail CI.
	await page.goto('/trips', { waitUntil: 'networkidle' });
	const tripsBodyBefore = await page.locator('body').innerText();
	const hadBangkokBaseline = /Bangkok/i.test(tripsBodyBefore);
	test.skip(
		!hadBangkokBaseline,
		'requires production-copy DB with a Bangkok trip (see scripts/seed-e2e-admin-compat.mjs)'
	);

	// 1) Create trip
	const { tripId, name } = await createTrip(page, { name: tripName });
	expect(name).toBe(tripName);
	await expect(page.locator('h1')).toContainText(tripName);

	// 2) Add itinerary note segment
	await page.goto(`/trips/${tripId}/segments/new`, { waitUntil: 'networkidle' });
	await page.getByRole('link', { name: 'Note', exact: true }).click();
	await page.waitForURL(`/trips/${tripId}/segments/new/note`, { waitUntil: 'networkidle' });
	await page.getByLabel('Note title').fill(segmentTitle);
	await page.getByLabel('Note', { exact: true }).fill('compat e2e segment body');
	await page.getByLabel('Date', { exact: true }).fill('2030-06-02');
	const tz = page.getByLabel('Timezone');
	if (await tz.count()) {
		await tz.selectOption('UTC').catch(() => undefined);
	}
	await page.click('button:has-text("Save")');
	await page.waitForURL(`/trips/${tripId}`, { waitUntil: 'networkidle' });
	const segment = page.locator('.trip-modern-segment', { hasText: segmentTitle });
	await expect(segment).toBeVisible();

	// 3) Edit segment inline — select card, click Edit, change title, save
	await segment.click();
	const details = page.getByRole('dialog', { name: 'Selected segment details' });
	await expect(details).toBeVisible({ timeout: 15_000 });
	await details.getByRole('button', { name: 'Edit', exact: true }).click();
	// Inline edit form on trip page
	const titleField = page.getByLabel('Note title').or(page.getByLabel(/^Title$/i)).first();
	await expect(titleField).toBeVisible({ timeout: 15_000 });
	await titleField.fill(editedSegmentTitle);
	await page.getByRole('button', { name: /save/i }).first().click();
	// After save, edited title visible on trip
	await expect(page.locator('.trip-modern-segment', { hasText: editedSegmentTitle })).toBeVisible({
		timeout: 30_000
	});

	// 4) Delete segment via panel + ConfirmModal
	await page.locator('.trip-modern-segment', { hasText: editedSegmentTitle }).click();
	await expect(details).toBeVisible({ timeout: 15_000 });
	await details.getByRole('button', { name: 'Delete', exact: true }).click();
	// ConfirmModal uses native <dialog class="modal-dialog"> with confirmLabel "Delete"
	const confirmModal = page.locator('dialog.modal-dialog[open]');
	await expect(confirmModal).toBeVisible({ timeout: 10_000 });
	await confirmModal.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(page.locator('.trip-modern-segment', { hasText: editedSegmentTitle })).toHaveCount(0, {
		timeout: 30_000
	});

	// 5) Edit trip details — trip must still show
	await page.goto(`/trips/${tripId}/edit`, { waitUntil: 'networkidle' });
	await page.getByLabel('Trip name').fill(editedTripName);
	await page.getByRole('button', { name: 'Save changes', exact: true }).click();
	await page.waitForURL(`/trips/${tripId}`, { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText(editedTripName);

	// 6) Delete trip
	await page.goto(`/trips/${tripId}/edit`, { waitUntil: 'networkidle' });
	const deleteTrip = page
		.getByRole('button', { name: /delete trip/i })
		.or(page.getByRole('button', { name: /^delete$/i }));
	await expect(deleteTrip.first()).toBeVisible({ timeout: 15_000 });
	await deleteTrip.first().click();
	const confirmTrip = page.getByRole('button', { name: /confirm|delete trip|yes/i });
	if (await confirmTrip.count()) {
		await confirmTrip.last().click();
	}
	await page.waitForURL(/\/trips(\/)?(\?|$)/, { waitUntil: 'networkidle', timeout: 30_000 });
	await page.goto('/trips', { waitUntil: 'networkidle' });
	await expect(page.getByText(editedTripName)).toHaveCount(0);
	await expect(page.getByText(tripName)).toHaveCount(0);

	// Pre-existing Bangkok trip still present after our qa-compat CRUD
	await expect(page.locator('body')).toContainText(/Bangkok/i);
});
