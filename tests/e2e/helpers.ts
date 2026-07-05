import type { Page } from '@playwright/test';

export async function createTrip(page: Page, opts: { name?: string; start?: string; end?: string } = {}) {
	const name = opts.name ?? `E2E Test Trip ${Date.now()}`;
	const start = opts.start ?? '2030-06-01';
	const end = opts.end ?? '2030-06-10';

	await page.goto('/trips/new', { waitUntil: 'networkidle' });
	await page.getByLabel('Trip name').fill(name);
	await page.getByLabel('Start date').fill(start);
	await page.getByLabel('End date').fill(end);
	await page.click('button:has-text("Create trip")');
	await page.waitForURL(/\/trips\/\d+/, { waitUntil: 'networkidle' });

	const url = page.url();
	const match = url.match(/\/trips\/(\d+)/);
	const tripId = match ? Number(match[1]) : null;
	if (!tripId) throw new Error(`Could not extract trip ID from ${url}`);

	return { tripId, name };
}
