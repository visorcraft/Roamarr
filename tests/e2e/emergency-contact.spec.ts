import { test, expect } from './fixtures';

test('add an emergency contact', async ({ page }) => {
	await page.goto('/profile/contacts', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toHaveText('Emergency Contacts');

	const name = `E2E Emergency ${Date.now()}`;
	const form = page.locator('form[action="?/addEmergencyContact"]');
	await form.getByLabel('Name', { exact: true }).fill(name);
	await form.getByLabel('Relationship', { exact: true }).fill('Friend');
	await form.getByLabel('Phone', { exact: true }).fill('555-0100');
	await form.getByLabel('Email', { exact: true }).fill('emergency@roamarr.test');
	await form.getByRole('button', { name: 'Add contact', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.getByText(name)).toBeVisible();
});
