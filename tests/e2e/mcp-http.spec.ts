import { test, expect, testNoAuth } from './fixtures';

testNoAuth('well-known discovery and unauthenticated /mcp', async ({ request }) => {
	const mcpJsonRes = await request.get('/.well-known/mcp.json');
	expect(mcpJsonRes.status()).toBe(200);
	const mcpJson = await mcpJsonRes.json();
	expect(mcpJson.endpoint).toMatch(/\/mcp$/);
	expect(mcpJson.capabilities?.tools).toBeDefined();
	expect(Array.isArray(mcpJson.scopes_supported) && mcpJson.scopes_supported.length > 0).toBeTruthy();

	const oauthRes = await request.get('/.well-known/oauth-authorization-server');
	expect(oauthRes.status()).toBe(200);
	const oauthJson = await oauthRes.json();
	expect(oauthJson.authorization_endpoint).toBeDefined();
	expect(oauthJson.token_endpoint).toBeDefined();
	expect(oauthJson.registration_endpoint).toBeDefined();

	const mcpPost = await request.post('/mcp', {
		data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }
	});
	expect(mcpPost.status()).toBe(401);
	expect(mcpPost.headers()['content-type']).toContain('application/json');
});

test('MCP endpoint over personal API key', async ({ page, playwright, baseURL }) => {
	// Create a key with the default trips:read scope checked.
	const keyName = `E2E MCP Key ${Date.now()}`;
	await page.goto('/profile/api-keys', { waitUntil: 'networkidle' });
	await expect(page.locator('h1')).toContainText('API Keys');
	await expect(page.locator('input[name="scopes"][value="trips:read"]')).toBeChecked();
	await page.locator('input#keyName').fill(keyName);
	await page.getByRole('button', { name: 'Create key' }).click();
	await page.waitForLoadState('networkidle');

	const tokenBanner = page.locator('section').filter({ hasText: 'Save your API key' });
	await expect(tokenBanner).toBeVisible();
	const token = (await tokenBanner.locator('code').first().innerText()).trim();
	expect(token.startsWith('rk_')).toBeTruthy();

	const api = await playwright.request.newContext({ baseURL });
	try {
		const authHeaders = {
			Authorization: `Bearer ${token}`,
			Accept: 'application/json, text/event-stream'
		};

		const init = await api.post('/mcp', {
			headers: authHeaders,
			data: {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'e2e', version: '1.0.0' }
				}
			}
		});
		expect(init.status()).toBe(200);
		const sessionId = init.headers()['mcp-session-id'];
		expect(sessionId).toBeTruthy();

		const list = await api.post('/mcp', {
			headers: { ...authHeaders, 'mcp-session-id': sessionId },
			data: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
		});
		expect(list.status()).toBe(200);
		const listBody = await list.json();
		expect(Array.isArray(listBody.result?.tools)).toBeTruthy();
		expect(listBody.result.tools.length).toBeGreaterThanOrEqual(144);

		const callTrip = await api.post('/mcp', {
			headers: { ...authHeaders, 'mcp-session-id': sessionId },
			data: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'roamarr_trip_list', arguments: {} } }
		});
		expect(callTrip.status()).toBe(200);
		const callTripBody = await callTrip.json();
		expect(callTripBody.result?.isError).toBeFalsy();

		const callCard = await api.post('/mcp', {
			headers: { ...authHeaders, 'mcp-session-id': sessionId },
			data: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'roamarr_card_list', arguments: {} } }
		});
		expect(callCard.status()).toBe(200);
		const callCardBody = await callCard.json();
		expect(callCardBody.result?.isError).toBe(true);
		expect(JSON.stringify(callCardBody.result?.content ?? [])).toContain('Missing required scope: cards:read');

		const del = await api.delete('/mcp', {
			headers: { Authorization: `Bearer ${token}`, 'mcp-session-id': sessionId }
		});
		expect([200, 204]).toContain(del.status());

		const trips = await api.get('/api/trips/autocomplete', { headers: { 'X-Api-Token': token } });
		expect(trips.status()).toBe(200);
		const tripsBody = await trips.json();
		expect(Array.isArray(tripsBody.trips)).toBe(true);

		const cards = await api.get('/api/cards', { headers: { 'X-Api-Token': token } });
		expect(cards.status()).toBe(403);
		expect(JSON.stringify(await cards.json())).toContain('Missing required scope: cards:read');

		const postTrips = await api.post('/api/trips', {
			headers: { 'X-Api-Token': token },
			data: { name: 'Denied' }
		});
		expect(postTrips.status()).toBe(403);
		expect(JSON.stringify(await postTrips.json())).toContain('Missing required scope: trips:write');
	} finally {
		await api.dispose();
		// Revoke the key through the UI so it does not linger.
		const keyRow = page.locator('li.list-item').filter({ hasText: keyName });
		await expect(keyRow).toBeVisible();
		await keyRow.getByRole('button', { name: 'Revoke' }).click();
		const dialog = page.locator('dialog[open]');
		await dialog.getByRole('button', { name: 'Confirm' }).click();
		await page.waitForLoadState('networkidle');
	}
});
