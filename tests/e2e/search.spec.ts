import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('search for a trip by name', async ({ page }) => {
	const { name } = await createTrip(page);

	await page.goto(`/search?q=${encodeURIComponent(name)}`, { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Search Results');
	await expect(page.getByText('1 trip found')).toBeVisible();
	await expect(page.getByText(name)).toBeVisible();
});
