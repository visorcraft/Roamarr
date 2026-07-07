import { test, expect } from './fixtures';

test('grid table renders themed under high-contrast', async ({ page }) => {
	await page.goto('/cards', { waitUntil: 'networkidle' });
	await expect(page.locator('.gridjs-wrapper')).toBeVisible();

	// Simulate the user selecting high-contrast by toggling the data-theme
	// attribute the same way applyThemePreview does on /profile. CSS variables
	// re-resolve on attribute change so this exercises the override block
	// directly without coupling the assertion to /profile form submission.
	await page.locator('.theme-root').evaluate((el, themeId) => {
		el.setAttribute('data-theme', themeId);
	}, 'high-contrast');
	await expect(page.locator('.theme-root')).toHaveAttribute('data-theme', 'high-contrast');

	const wrapperBg = await page.locator('.gridjs-wrapper').evaluate(
		(el) => getComputedStyle(el).backgroundColor
	);
	// Mermaid's white background and the unthemed default should both be gone.
	expect(wrapperBg).not.toBe('rgb(255, 255, 255)');
	expect(wrapperBg).not.toBe('rgba(0, 0, 0, 0)');
});

test('add a payment card', async ({ page }) => {
	const nickname = `E2E Card ${Date.now()}`;
	const last4 = String(Date.now()).slice(-4);

	await page.goto('/cards', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Cards');
	await page.getByRole('link', { name: 'Add card' }).click();
	await page.waitForURL('/cards/new', { waitUntil: 'networkidle' });

	const form = page.locator('section.card');
	await form.getByLabel('Nickname', { exact: true }).fill(nickname);
	await form.getByLabel('Network', { exact: true }).selectOption('visa');
	await form.getByLabel('Last 4', { exact: true }).fill(last4);
	await form.getByRole('button', { name: 'Add card', exact: true }).click();
	await page.waitForURL('/cards', { waitUntil: 'networkidle' });

	await expect(page.getByText(nickname)).toBeVisible();
	await expect(page.getByText(`…${last4}`)).toBeVisible();
});

test('rejects a card without a nickname', async ({ page }) => {
	await page.goto('/cards/new', { waitUntil: 'networkidle' });

	const form = page.locator('section.card');
	const nicknameInput = form.getByLabel('Nickname', { exact: true });
	await nicknameInput.fill('');
	// Bypass browser required validation so the server validator runs.
	await nicknameInput.evaluate((el: HTMLInputElement) => el.removeAttribute('required'));
	await form.getByLabel('Network', { exact: true }).selectOption('visa');
	await form.getByLabel('Last 4', { exact: true }).fill('1234');
	await form.getByRole('button', { name: 'Add card', exact: true }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.locator('.notice.notice-error')).toContainText('Please fix the highlighted fields');
	await expect(page.getByText('nickname is required')).toBeVisible();
});
