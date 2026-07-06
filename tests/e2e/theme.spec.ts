import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function selectTheme(page: Page, labelText: string, value: string) {
	const input = page.locator(`input[name="themeId"][value="${value}"]`);
	const label = page.locator(`label:has-text("${labelText}")`);
	const badge = page.locator('#theme-label + .badge.badge-brand');
	await label.click();
	await expect(badge).toContainText(labelText);
	await expect(input).toBeChecked();
}

test('change user theme', async ({ page }) => {
	await page.goto('/profile', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Your profile');

	await selectTheme(page, 'High Contrast', 'high-contrast');
	await page.getByRole('button', { name: 'Save profile', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', 'high-contrast');

	// Reset to the default so later test runs / local browsing start from Follow system.
	await selectTheme(page, 'Follow system', 'system');
	await page.getByRole('button', { name: 'Save profile', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', 'system');
});
