import { test, expect } from './fixtures';

test('create an API key, see the token once, then revoke it', async ({ page }) => {
	const keyName = `E2E Key ${Date.now()}`;

	await page.goto('/profile/api-keys', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('API Keys');

	// trips:read is pre-selected; keep it as the granted read scope.
	await expect(page.locator('input[name="scopes"][value="trips:read"]')).toBeChecked();
	await page.locator('input#keyName').fill(keyName);
	await page.getByRole('button', { name: 'Create key' }).click();
	await page.waitForLoadState('networkidle');

	// The raw token is shown exactly once.
	const tokenBanner = page.locator('section').filter({ hasText: 'Save your API key' });
	await expect(tokenBanner).toBeVisible();
	const token = (await tokenBanner.locator('code').first().innerText()).trim();
	expect(token.startsWith('rk_')).toBeTruthy();

	await tokenBanner.getByRole('button', { name: 'I saved it' }).click();
	await expect(tokenBanner).toBeHidden();

	// A reload does not bring the token back.
	await page.reload({ waitUntil: 'networkidle' });
	await expect(page.locator('section').filter({ hasText: 'Save your API key' })).toHaveCount(0);

	// Revoke the key.
	const keyRow = page.locator('li.list-item').filter({ hasText: keyName });
	await expect(keyRow).toBeVisible();
	await keyRow.getByRole('button', { name: 'Revoke' }).click();
	const dialog = page.locator('dialog[open]');
	await dialog.getByRole('button', { name: 'Confirm' }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.locator('li.list-item').filter({ hasText: keyName })).toContainText('revoked');
	await expect(
		page.locator('li.list-item').filter({ hasText: keyName }).getByRole('button', { name: 'Revoke' })
	).toHaveCount(0);
});
