import { testNoAuth as test, expect } from './fixtures';

test('log in with the seeded admin account', async ({ page }) => {
	await page.goto('/login', { waitUntil: 'networkidle' });
	await page.getByLabel('Email').fill('e2e-admin@roamarr.test');
	await page.getByLabel('Password').fill('e2e-correct-horse-battery-staple');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await page.waitForURL('/', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Welcome back');
});
