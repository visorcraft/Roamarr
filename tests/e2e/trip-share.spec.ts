import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('trip has a public share link', async ({ page }) => {
	const { tripId, name } = await createTrip(page);

	await page.goto(`/trips/${tripId}/share`, { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Share trip');
	await expect(page.getByText(`Control who can see ${name}.`)).toBeVisible();

	await expect(page.getByText('Anyone with this link can view the trip.')).toBeVisible();
	await expect(page.locator('section:has-text("Public link") p.code-chip')).toContainText(`/share/`);
});
