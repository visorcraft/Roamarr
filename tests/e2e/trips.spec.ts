import { test, expect } from './fixtures';
import { createTrip } from './helpers';

test('create a new trip', async ({ page }) => {
	const { name } = await createTrip(page);
	await expect(page.locator('h1')).toContainText(name);
});
