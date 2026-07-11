import { testNoAuth as test, expect } from './fixtures';
import { E2E_ADMIN } from './credentials';

test('log in with the seeded admin account', async ({ page }) => {
	await page.goto('/login', { waitUntil: 'networkidle' });
	await page.getByLabel('Email').fill(E2E_ADMIN.email);
	await page.getByLabel('Password').fill(E2E_ADMIN.password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page.waitForURL('/', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Welcome back');
});
