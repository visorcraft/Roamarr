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

	test('clicking a section header collapses and expands it independently', async ({ page }) => {
		const planHeader = getSectionHeader(page, 'Plan');
		const planItems = getSectionItems(page, 'Plan');
		const meHeader = getSectionHeader(page, 'Me');
		const meItems = getSectionItems(page, 'Me');

		// All sections start expanded.
		await expect(planHeader).toHaveAttribute('aria-expanded', 'true');
		await expect(planItems).toBeVisible();
		await expect(meHeader).toHaveAttribute('aria-expanded', 'true');
		await expect(meItems).toBeVisible();

		// Collapsing Plan does not affect Me.
		await planHeader.click();
		await expect(planHeader).toHaveAttribute('aria-expanded', 'false');
		await expect(planItems).toHaveClass(/hidden/);
		await expect(meHeader).toHaveAttribute('aria-expanded', 'true');
		await expect(meItems).toBeVisible();

		// Expanding Plan does not collapse Me.
		await planHeader.click();
		await expect(planHeader).toHaveAttribute('aria-expanded', 'true');
		await expect(planItems).not.toHaveClass(/hidden/);
		await expect(meHeader).toHaveAttribute('aria-expanded', 'true');
		await expect(meItems).toBeVisible();
	});

	test('navigating to a route inside a collapsed section expands it without collapsing others', async ({ page }) => {
		await collapseSidebarSection(page, 'Plan');
		await expect(getSectionHeader(page, 'Plan')).toHaveAttribute('aria-expanded', 'false');

		await page.goto('/trips', { waitUntil: 'networkidle' });
		await expect(getSectionHeader(page, 'Plan')).toHaveAttribute('aria-expanded', 'true');
		await expect(getSectionItems(page, 'Plan')).toBeVisible();
		// Other sections remain in their previous state.
		await expect(getSectionHeader(page, 'Me')).toHaveAttribute('aria-expanded', 'true');
	});

	test('Visited toggle is a single button with integrated chevron', async ({ page }) => {
		const visitedButton = page.locator('button[aria-controls="nav-item-children-visited"]');
		await expect(visitedButton).toHaveCount(1);
		await expect(visitedButton).toHaveAttribute('aria-expanded', 'false');

		// There should be no separate toggle button next to the Visited link.
		const visitedLink = page.locator('a[href="/profile/visited"]');
		await expect(visitedLink).toHaveCount(0);

		await visitedButton.click();
		await expect(visitedButton).toHaveAttribute('aria-expanded', 'true');
		await expect(page.locator('a[href="/profile/visited/countries"]')).toBeVisible();
		await expect(page.locator('a[href="/profile/visited/states"]')).toBeVisible();
	});

	test('only the matching submenu item is active on nested profile pages', async ({ page }) => {
		await page.goto('/profile/contacts', { waitUntil: 'networkidle' });

		const activeChildren = page.locator('#nav-item-children-profile a.app-nav-item-active');
		await expect(activeChildren).toHaveCount(1);
		await expect(page.locator('#nav-item-children-profile a[href="/profile/contacts"]')).toHaveClass(
			/app-nav-item-active/
		);
		await expect(
			page.locator('#nav-item-children-profile a[href="/profile"]')
		).not.toHaveClass(/app-nav-item-active/);
	});

	test('highlights the specific sibling item instead of the parent prefix', async ({ page }) => {
		await page.goto('/profile/loyalty', { waitUntil: 'networkidle' });

		const meSection = page.locator('section[data-section="Me"]');
		await expect(meSection.locator('a[href="/profile/loyalty"]')).toHaveClass(/app-nav-item-active/);
		await expect(
			meSection.locator('button[aria-controls="nav-item-children-profile"]')
		).not.toHaveClass(/app-nav-item-active/);
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

	test('tapping a link closes the mobile drawer', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/', { waitUntil: 'networkidle' });

		const dialog = page.locator('aside[role="dialog"]');
		await page.getByLabel('Open menu').click();
		await expect(dialog).toBeVisible();

		await dialog.getByRole('link', { name: 'Trips', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL('/trips');
	});

	test('focus is trapped inside the mobile drawer', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/', { waitUntil: 'networkidle' });

		await page.getByLabel('Open menu').click();
		const dialog = page.locator('aside[role="dialog"]');
		await expect(dialog).toBeVisible();

		// Focus should start inside the drawer.
		await expect(dialog.locator(':focus')).toHaveCount(1);

		// Focus the first focusable element explicitly, then Shift+Tab should wrap to the last.
		const first = dialog.locator('a, button').first();
		await first.focus();
		await page.keyboard.press('Shift+Tab');
		const last = dialog.locator('a, button').last();
		await expect(last).toBeFocused();

		// Tab from the last element should wrap back to the first.
		await last.focus();
		await page.keyboard.press('Tab');
		await expect(first).toBeFocused();
	});

	test('Escape closes the mobile drawer and returns focus to the hamburger', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/', { waitUntil: 'networkidle' });

		const openButton = page.getByLabel('Open menu');
		await openButton.click();
		const dialog = page.locator('aside[role="dialog"]');
		await expect(dialog).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(openButton).toBeFocused();
	});

	test('arrow keys move focus between section headers in mobile drawer', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/', { waitUntil: 'networkidle' });

		await page.getByLabel('Open menu').click();
		const firstHeader = getSectionHeader(page, 'Plan');
		await firstHeader.focus();
		await expect(firstHeader).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(getSectionHeader(page, 'Me')).toBeFocused();

		await page.keyboard.press('ArrowUp');
		await expect(firstHeader).toBeFocused();
	});
});
