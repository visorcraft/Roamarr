import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('create a public share link for a trip', async ({ page }) => {
	const { tripId, name } = await createTrip(page);

	await page.goto(`/trips/${tripId}/share`, { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Share trip');
	await expect(page.getByText(`Control who can see ${name}.`)).toBeVisible();

	await page.getByRole('button', { name: 'Create public link', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.getByText('Anyone with this link can view the trip.')).toBeVisible();
	await expect(page.locator('section:has-text("Public link") p.code-chip')).toContainText(`/share/`);
});
