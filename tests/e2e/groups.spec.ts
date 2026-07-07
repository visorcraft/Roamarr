import { test, expect } from './fixtures';

test('create a group', async ({ page }) => {
	await page.goto('/groups', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Groups');

	const name = `E2E Group ${Date.now()}`;
	await page.getByRole('link', { name: 'Create group', exact: true }).click();
	await page.waitForURL('/groups/new', { waitUntil: 'networkidle' });

	await page.getByLabel('Group name', { exact: true }).fill(name);
	await page.getByRole('button', { name: 'Create group', exact: true }).click();
	await page.waitForURL('/groups', { waitUntil: 'networkidle' });

	const row = page.locator('.gridjs-tr', { hasText: name });
	await expect(row).toBeVisible();
	await expect(row.getByText('0 members')).toBeVisible();
});

test('rejects adding a non-existent group member without enumeration', async ({ page }) => {
	await page.goto('/groups/new', { waitUntil: 'networkidle' });

	const name = `E2E Group Member Test ${Date.now()}`;
	await page.getByLabel('Group name', { exact: true }).fill(name);
	await page.getByRole('button', { name: 'Create group', exact: true }).click();
	await page.waitForURL('/groups', { waitUntil: 'networkidle' });

	// Open the group edit page to add a member.
	const row = page.locator('.gridjs-tr', { hasText: name });
	await row.getByRole('button', { name: 'Edit' }).click();
	await page.waitForURL(/\/groups\/\d+\/edit/, { waitUntil: 'networkidle' });

	const addForm = page.locator('form[action="?/addMember"]');
	await addForm.getByLabel('Add member', { exact: true }).fill('not-a-user@roamarr.test');
	await addForm.getByRole('button', { name: 'Add' }).click();
	await page.waitForLoadState('networkidle');

	await expect(page.locator('.notice.notice-error')).toContainText('Could not add member');
});
