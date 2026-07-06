import { test as setup, expect } from '@playwright/test';

const ADMIN = {
	displayName: 'E2E Admin',
	email: 'e2e-admin@roamarr.test',
	password: 'e2e-correct-horse-battery-staple'
};

setup('create admin account', async ({ page, baseURL }) => {
	await page.goto('/setup', { waitUntil: 'networkidle' });

	// If already set up, log in instead.
	if (!page.url().includes('/setup')) {
		await page.goto('/login', { waitUntil: 'networkidle' });
		await page.fill('input#email', ADMIN.email);
		await page.fill('input#password', ADMIN.password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await page.waitForURL(baseURL || '/', { waitUntil: 'networkidle' });
		await page.context().storageState({ path: 'tests/e2e/.auth/user.json' });
		return;
	}

	// Step 1
	await page.fill('input#instanceName', 'Roamarr E2E');
	await page.selectOption('select#timezone', 'UTC');
	await expect(page.locator('li:has-text("ROAMARR_SECRET is set")')).toBeVisible();
	await expect(page.locator('li:has-text("Database encryption verified")')).toBeVisible();
	await expect(page.locator('li:has-text("Database writable")')).toBeVisible();
	await page.click('button:has-text("Continue")');

	// Step 2
	await page.fill('input#displayName', ADMIN.displayName);
	await page.fill('input#email', ADMIN.email);
	await page.fill('input#password', ADMIN.password);
	await page.fill('input#confirmPassword', ADMIN.password);

	await Promise.all([
		page.waitForURL(baseURL || '/', { waitUntil: 'networkidle' }),
		page.click('button:has-text("Create admin")')
	]);

	await page.context().storageState({ path: 'tests/e2e/.auth/user.json' });
});
