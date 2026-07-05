import { test, expect } from './fixtures';

test('change password from profile', async ({ page }) => {
	await page.goto('/profile', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Your profile');

	const newPassword = 'e2e-new-correct-horse-battery-staple';
	const section = page.locator('section:has-text("Change password")');
	await section.getByLabel('Current password', { exact: true }).fill('e2e-correct-horse-battery-staple');
	await section.getByLabel('New password', { exact: true }).fill(newPassword);
	await section.getByLabel('Confirm new password', { exact: true }).fill(newPassword);
	await section.getByRole('button', { name: 'Update password', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.locator('h1')).toContainText('Your profile');
});
