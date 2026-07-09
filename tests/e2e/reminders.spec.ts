import { test, expect } from './fixtures';

test('reminders page loads', async ({ page }) => {
	await page.goto('/profile/reminders', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Reminders');
	await expect(page.getByText('Scheduled alerts for trips, flights, and travel documents.')).toBeVisible();
});
