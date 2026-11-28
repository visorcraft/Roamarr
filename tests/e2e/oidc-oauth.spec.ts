import { expect, testNoAuth } from './fixtures';

testNoAuth('OIDC start and callback redirect to login when not configured', async ({ page }) => {
	await page.goto('/auth/oidc/start');
	await expect(page).toHaveURL(/\/login/);
	await expect(page.locator('body')).toContainText(/not configured/i);

	await page.goto('/auth/oidc/callback?code=fake&state=fake');
	await expect(page).toHaveURL(/\/login/);
	await expect(page.locator('body')).toContainText(/not configured/i);
});

testNoAuth('OAuth authorize redirects to login when unauthenticated', async ({ page }) => {
	await page.goto('/oauth/authorize?client_id=test&redirect_uri=https://app.example/cb&response_type=code');
	await expect(page).toHaveURL(/\/login/);
});

testNoAuth('dynamic client registration', async ({ request }) => {
	const res = await request.post('/oauth/register', {
		data: { client_name: 'E2E Client', redirect_uris: ['https://e2e-client.example/cb'] }
	});
	expect(res.status()).toBe(201);
	expect(res.headers()['access-control-allow-origin']).toBe('*');
	const body = await res.json();
	expect(body.client_id).toBeDefined();

	const bad = await request.post('/oauth/register', {
		data: { client_name: 'E2E Bad', redirect_uris: ['http://evil.example/cb'] }
	});
	expect(bad.status()).toBe(400);
});
