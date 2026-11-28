import { test, expect } from './fixtures';
import { createHash } from 'node:crypto';

test('backup page, backup download, and email settings pages', async ({ page }) => {
	await page.goto('/backup', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('Backup & Restore');
	await expect(page.getByRole('link', { name: 'Download backup' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Automatic backups' })).toBeVisible();
	const restoreButton = page.getByRole('button', { name: 'Restore backup' });
	await expect(restoreButton).toBeDisabled();
	await page
		.locator('label.checkbox-label', { hasText: 'I understand this will overwrite' })
		.locator('input[type="checkbox"]')
		.check();
	await expect(restoreButton).toBeEnabled();

	const res = await page.request.get('/backup');
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toContain('application/gzip');
	expect(res.headers()['content-disposition']).toContain('.mongreldb.tar.gz');
	expect(res.headers()['x-backup-sha256']).toMatch(/^[0-9a-f]{64}$/);
	const body = await res.body();
	expect(body[0]).toBe(0x1f);
	expect(body[1]).toBe(0x8b);
	expect(createHash('sha256').update(body).digest('hex')).toBe(res.headers()['x-backup-sha256']);

	for (const path of ['/profile/email_processing', '/profile/email_parsing', '/profile/email_sender', '/general/email']) {
		const resp = await page.goto(path, { waitUntil: 'networkidle' });
		expect(resp?.status()).toBe(200);
		await expect(page.locator('h1')).toBeVisible();
	}
});
