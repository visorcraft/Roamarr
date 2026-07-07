import { test, expect } from './fixtures';

test('run scheduler now and see a new run in the GridTable', async ({ page }) => {
	await page.goto('/jobs', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Scheduled job runs');

	// Wait for the GridTable to finish its initial fetch.
	await expect(page.locator('.gridjs-wrapper')).toBeVisible();

	await page.getByRole('button', { name: 'Run scheduler now' }).click();
	await page.waitForURL('/jobs', { waitUntil: 'networkidle' });

	// A new run row should appear.
	await expect(page.getByText('OK').first()).toBeVisible();
});
