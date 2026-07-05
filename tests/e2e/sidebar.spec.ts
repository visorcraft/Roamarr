import { test, expect } from './fixtures';
import {
	getSection,
	getSectionHeader,
	getSectionItems,
	collapseSidebarSection
} from './helpers';

const STORAGE_KEY = 'roamarr.sidebar.sections';

test.describe('desktop sidebar', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' });
		await page.evaluate(() => localStorage.removeItem('roamarr.sidebar.sections'));
		await page.reload({ waitUntil: 'networkidle' });
	});

	test('defaults expanded and admin section is visible', async ({ page }) => {
		for (const label of ['Plan', 'Me', 'Organizer']) {
			const header = getSectionHeader(page, label);
			await expect(header).toHaveAttribute('aria-expanded', 'true');
			await expect(getSectionItems(page, label)).toBeVisible();
		}

		await expect(getSection(page, 'Admin')).toBeVisible();
		await expect(getSectionHeader(page, 'Admin')).toHaveAttribute('aria-expanded', 'true');
	});

	test('clicking a section header collapses and expands it', async ({ page }) => {
		const header = getSectionHeader(page, 'Plan');
		const items = getSectionItems(page, 'Plan');

		await expect(header).toHaveAttribute('aria-expanded', 'true');
		await expect(items).toBeVisible();

		await header.click();
		await expect(header).toHaveAttribute('aria-expanded', 'false');
		await expect(items).toHaveCount(0);

		await header.click();
		await expect(header).toHaveAttribute('aria-expanded', 'true');
		await expect(items).toBeVisible();
	});

	test('collapse state persists across reload', async ({ page }) => {
		await collapseSidebarSection(page, 'Me');
		await expect(getSectionHeader(page, 'Me')).toHaveAttribute('aria-expanded', 'false');

		const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
		expect(stored).not.toBeNull();
		expect(JSON.parse(stored!)).toEqual(expect.objectContaining({ Me: false }));

		await page.reload({ waitUntil: 'networkidle' });
		await expect(getSectionHeader(page, 'Me')).toHaveAttribute('aria-expanded', 'false');
		await expect(getSectionItems(page, 'Me')).toHaveCount(0);
	});

	test('navigating to a route inside a collapsed section expands it automatically', async ({ page }) => {
		await collapseSidebarSection(page, 'Plan');
		await expect(getSectionHeader(page, 'Plan')).toHaveAttribute('aria-expanded', 'false');

		await page.goto('/trips', { waitUntil: 'networkidle' });
		await expect(getSectionHeader(page, 'Plan')).toHaveAttribute('aria-expanded', 'true');
		await expect(getSectionItems(page, 'Plan')).toBeVisible();
	});

	test('unread notifications badge moves to Plan header when collapsed', async ({ page }) => {
		// Start from a clean notification state so the badge count is predictable.
		await page.goto('/notifications', { waitUntil: 'networkidle' });
		const markAllRead = page.getByRole('button', { name: 'Mark all read' });
		if (await markAllRead.isVisible().catch(() => false)) {
			await markAllRead.click();
			await page.waitForLoadState('networkidle');
		}

		// Seed an unread notification using the existing admin test action.
		await page.goto('/settings', { waitUntil: 'networkidle' });
		await page.getByRole('button', { name: 'Send test notification' }).click();
		await page.waitForLoadState('networkidle');

		await page.goto('/', { waitUntil: 'networkidle' });

		const planHeader = getSectionHeader(page, 'Plan');
		const notificationsLink = page.locator('a[href="/notifications"]');

		// Expanded: badge lives on the notifications link.
		await expect(planHeader.locator('.app-unread-count')).toHaveCount(0);
		await expect(notificationsLink.locator('.app-unread-count')).toBeVisible();
		const expandedCount = await notificationsLink.locator('.app-unread-count').textContent();
		expect(expandedCount).toMatch(/^[1-9]\d*$/);

		// Collapsed: badge moves to the Plan header with the same count.
		await collapseSidebarSection(page, 'Plan');
		await expect(planHeader.locator('.app-unread-count')).toBeVisible();
		await expect(planHeader.locator('.app-unread-count')).toHaveText(expandedCount!);

		// Clean up so later test runs start from zero unread notifications.
		await page.goto('/notifications', { waitUntil: 'networkidle' });
		await page.getByRole('button', { name: 'Mark all read' }).click();
		await page.waitForLoadState('networkidle');
	});
});

test.describe('mobile sidebar drawer', () => {
	test('hamburger menu opens grouped sections', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/', { waitUntil: 'networkidle' });

		const dialog = page.locator('aside[role="dialog"]');
		await expect(dialog).toHaveCount(0);

		await page.getByLabel('Open menu').click();
		await expect(dialog).toBeVisible();

		for (const label of ['Plan', 'Me', 'Organizer', 'Admin']) {
			await expect(dialog.locator(`section[data-section="${label}"]`)).toBeVisible();
		}
	});
});
