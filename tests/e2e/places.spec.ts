import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

function uid() {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function placeRow(page: Page, name: string) {
	return page.locator('ul.divide-y > li').filter({ hasText: name });
}

async function addPlace(page: Page, name: string, opts: { category?: string; status?: string } = {}) {
	// The place form is long; give the fixed-position modal room so the
	// submit button lands inside the viewport.
	await page.setViewportSize({ width: 1440, height: 1600 });
	await page.getByRole('button', { name: 'Add place' }).click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog).toBeVisible();
	await dialog.getByLabel('Name').fill(name);
	if (opts.category) await dialog.getByLabel('Category').selectOption({ label: opts.category });
	if (opts.status) await dialog.getByLabel('Status').selectOption(opts.status);
	await dialog.getByRole('button', { name: 'Add place' }).click();
	await page.waitForURL('/places', { waitUntil: 'networkidle' });
}

test('create, edit, mark visited, and delete a place', async ({ page }) => {
	const name = `E2E Place ${uid()}`;
	const renamed = `${name} renamed`;

	await page.goto('/places', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Places');

	await addPlace(page, name);
	await expect(placeRow(page, name)).toBeVisible();

	// Edit the name via the modal.
	await page.setViewportSize({ width: 1440, height: 1600 });
	await placeRow(page, name).getByTitle('Edit').click();
	const dialog = page.locator('dialog[open]');
	await expect(dialog).toBeVisible();
	await dialog.getByLabel('Name').fill(renamed);
	await dialog.getByRole('button', { name: 'Save changes' }).click();
	await page.waitForURL('/places', { waitUntil: 'networkidle' });
	await expect(placeRow(page, renamed)).toBeVisible();

	// Mark as visited.
	await placeRow(page, renamed).getByTitle('Mark as visited').click();
	await page.waitForURL('/places', { waitUntil: 'networkidle' });
	await expect(placeRow(page, renamed).locator('.badge').filter({ hasText: 'visited' })).toBeVisible();

	// Delete via the confirmation dialog. ConfirmButton consumes its title
	// prop for the modal head, so the trigger button has no title — target
	// it through its form action instead.
	await placeRow(page, renamed).locator('form[action="?/deletePlace"] > button').click();
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Delete' }).click();
	await page.waitForURL('/places', { waitUntil: 'networkidle' });
	await expect(placeRow(page, renamed)).toHaveCount(0);
});

test('categories and status filter', async ({ page }) => {
	const run = uid();
	const category = `E2E Category ${run}`;
	const visitedName = `E2E Visited Place ${run}`;
	const plannedName = `E2E Planned Place ${run}`;

	await page.goto('/places', { waitUntil: 'networkidle' });

	// Create a category.
	await page.getByLabel('New category').fill(category);
	await page.getByRole('button', { name: 'Add category' }).click();
	await page.waitForURL('/places', { waitUntil: 'networkidle' });
	await expect(page.getByText(category).first()).toBeVisible();

	await addPlace(page, visitedName, { category, status: 'visited' });
	await addPlace(page, plannedName, { category, status: 'planned' });

	// Filter by status.
	await page.locator('select#places-status').selectOption('visited');
	await page.getByRole('button', { name: 'Filter' }).click();
	await page.waitForURL(/status=visited/, { waitUntil: 'networkidle' });
	await expect(placeRow(page, visitedName)).toBeVisible();
	await expect(placeRow(page, plannedName)).toHaveCount(0);

	// The category chip filters by category and keeps both statuses.
	await page.goto('/places', { waitUntil: 'networkidle' });
	await page.getByRole('link', { name: category }).click();
	await page.waitForURL(/category=/, { waitUntil: 'networkidle' });
	await expect(placeRow(page, visitedName)).toBeVisible();
	await expect(placeRow(page, plannedName)).toBeVisible();
});

test('import places from a Takeout CSV with preview and confirm', async ({ page }) => {
	const run = uid();
	const alpha = `E2E Import Alpha ${run}`;
	const beta = `E2E Import Beta ${run}`;
	const csv = ['Title,Note,URL,Comment', `${alpha},First note,,`, `${beta},Second note,,`].join('\n');

	await page.goto('/places/import', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Import places');

	await page.locator('input#file').setInputFiles({
		name: 'saved.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(csv, 'utf-8')
	});
	await page.getByRole('button', { name: 'Preview import' }).click();
	await page.waitForLoadState('networkidle');

	// Preview shows both rows before anything is written.
	await expect(page.locator('h2').filter({ hasText: 'Preview' })).toBeVisible();
	await expect(page.locator('td').filter({ hasText: alpha }).first()).toBeVisible();
	await expect(page.locator('td').filter({ hasText: beta }).first()).toBeVisible();

	await page.getByRole('button', { name: 'Import 2 places' }).click();
	await page.waitForLoadState('networkidle');
	await expect(page.getByText('Imported 2 places')).toBeVisible();

	await page.goto('/places', { waitUntil: 'networkidle' });
	await expect(placeRow(page, alpha)).toBeVisible();
	await expect(placeRow(page, beta)).toBeVisible();
});
