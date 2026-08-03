import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('edit a trip name', async ({ page }) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}/edit`, { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Edit trip');

	const newName = `E2E Edited Trip ${Date.now()}`;
	await page.getByLabel('Trip name').fill(newName);
	await page.getByRole('button', { name: 'Save changes', exact: true }).click();
	await page.waitForURL(`/trips/${tripId}`, { waitUntil: 'load' });

	await expect(page.locator('h1')).toContainText(newName);
});

test('edit trip persists notes and reloads them in the textarea', async ({ page }) => {
	const { tripId } = await createTrip(page);
	const notes = `E2E notes ${Date.now()}`;

	await page.goto(`/trips/${tripId}/edit`, { waitUntil: 'networkidle' });
	await page.getByLabel('Notes').fill(notes);
	await page.getByRole('button', { name: 'Save changes', exact: true }).click();
	await page.waitForURL(`/trips/${tripId}`, { waitUntil: 'load' });

	// Overview shows the notes
	await expect(page.getByText(notes)).toBeVisible();

	// Re-open edit: notes must appear in the textarea (value prop, not children)
	await page.goto(`/trips/${tripId}/edit`, { waitUntil: 'networkidle' });
	await expect(page.getByLabel('Notes')).toHaveValue(notes);
});

test('edit trip with destination city re-saves without re-picking from autocomplete', async ({
	page
}) => {
	const { tripId } = await createTrip(page);

	await page.goto(`/trips/${tripId}/edit`, { waitUntil: 'networkidle' });
	await page.getByLabel('Destination country').selectOption('TH');
	// Type exact city name without picking from the list — backend should resolve coords
	await page.getByLabel('City').fill('Bangkok');
	await page.getByLabel('Notes').fill('Bangkok notes');
	await page.getByRole('button', { name: 'Save changes', exact: true }).click();
	await page.waitForURL(`/trips/${tripId}`, { waitUntil: 'load' });

	// Re-open and Save again without touching city (coords must be seeded in hidden inputs,
	// and backend must accept exact-name resolution if they are empty)
	await page.goto(`/trips/${tripId}/edit`, { waitUntil: 'networkidle' });
	await expect(page.getByLabel('City')).toHaveValue('Bangkok');
	await expect(page.getByLabel('Notes')).toHaveValue('Bangkok notes');
	// Hidden lat/lng should be populated when maps/city DB are available; either way
	// save must succeed (seeded coords OR backend auto-resolve).
	await page.getByLabel('Trip name').fill(`Bangkok re-save ${Date.now()}`);
	await page.getByRole('button', { name: 'Save changes', exact: true }).click();
	await page.waitForURL(`/trips/${tripId}`, { waitUntil: 'load' });
	await expect(page.locator('.notice.notice-error')).toHaveCount(0);
	await expect(page.getByText('City coordinates are missing')).toHaveCount(0);
});
