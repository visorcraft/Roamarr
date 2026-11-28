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

testNoAuth('dynamic client registration enforces settings and validates payloads', async ({ request }) => {
	// Fresh instances default allowUserMcpClients=false -> 403 with OAuth CORS header.
	const disabled = await request.post('/oauth/register', {
		data: { client_name: 'E2E Client', redirect_uris: ['https://e2e-client.example/cb'] }
	});
	expect(disabled.status()).toBe(403);
	expect(disabled.headers()['access-control-allow-origin']).toBe('*');
	const disabledBody = await disabled.json();
	expect(disabledBody.error).toBe('invalid_client_metadata');

	// Non-JSON payloads are rejected with 400 before checking settings.
	const badContentType = await request.post('/oauth/register', {
		headers: { 'content-type': 'text/plain' },
		data: 'not-json'
	});
	expect(badContentType.status()).toBe(400);
	const badBody = await badContentType.json();
	expect(badBody.error).toBe('invalid_client_metadata');
});
