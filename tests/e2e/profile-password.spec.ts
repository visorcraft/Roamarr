import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';

const ORIGINAL_PASSWORD = 'e2e-correct-horse-battery-staple';
const NEW_PASSWORD = 'e2e-new-correct-horse-battery-staple';

async function updatePassword(page: Page, currentPassword: string, newPassword: string) {
	const section = page.locator('section:has-text("Change password")');
	await section.getByLabel('Current password', { exact: true }).fill(currentPassword);
	await section.getByLabel('New password', { exact: true }).fill(newPassword);
	await section.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
	await section.getByRole('button', { name: 'Update password', exact: true }).click();
	await page.waitForLoadState('networkidle');
}

test('change password from profile', async ({ page }) => {
	await page.goto('/profile/security', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Security');

	await updatePassword(page, ORIGINAL_PASSWORD, NEW_PASSWORD);
	await expect(page.locator('h1')).toContainText('Security');

	// Restore the shared admin password so subsequent test runs can log in.
	await updatePassword(page, NEW_PASSWORD, ORIGINAL_PASSWORD);
	await expect(page.locator('h1')).toContainText('Security');
});
