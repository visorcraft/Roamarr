import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET as startGET } from './start/+server';
import { GET as callbackGET } from './callback/+server';
import {
	_testSignRs256,
	clearOidcCaches,
	createOidcFlow,
	verifyOidcFlowCookie
} from '$lib/server/oidc';
import { updateSettings } from '$lib/server/settings';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';
import { makeUser } from '../../../../tests/helpers';
import { load as loginLoad } from '../../login/+page.server';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

const ISSUER = 'https://idp.example.com';
const CLIENT_ID = 'roamarr';

const DISCOVERY_DOC = {
	issuer: ISSUER,
	authorization_endpoint: `${ISSUER}/authorize`,
	token_endpoint: `${ISSUER}/token`,
	jwks_uri: `${ISSUER}/jwks`
};

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'route-key' };

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function configureOidc() {
	updateSettings({
		oidcEnabled: true,
		oidcDiscoveryUrl: ISSUER,
		oidcClientId: CLIENT_ID,
		oidcDisplayName: 'Test SSO'
	});
}

function mockEvent(over: Record<string, unknown> = {}) {
	return {
		cookies: { set: vi.fn(), get: vi.fn(() => undefined), delete: vi.fn(), getAll: vi.fn(() => []) },
		getClientAddress: () => '10.0.0.1',
		url: new URL('https://app.example.com/auth/oidc/start'),
		request: new Request('https://app.example.com/auth/oidc/start'),
		...over
	} as never;
}

beforeEach(() => {
	resetRateLimit();
	clearOidcCaches();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

test('start redirects to /login with a flash when SSO is not configured', async () => {
	updateSettings({ oidcEnabled: false, oidcDiscoveryUrl: null, oidcClientId: null });
	const cookies = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
	try {
		await startGET(mockEvent({ cookies }));
		expect.unreachable('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/login');
	}
	expect(cookies.set).toHaveBeenCalledWith('flash', expect.any(String), expect.any(Object));
});

test('start redirects to the provider with PKCE and sets the flow cookie', async () => {
	configureOidc();
	vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(DISCOVERY_DOC)));
	const cookies = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
	try {
		await startGET(mockEvent({ cookies }));
		expect.unreachable('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(302);
		const target = new URL(e.location);
		expect(target.origin + target.pathname).toBe(`${ISSUER}/authorize`);
		expect(target.searchParams.get('client_id')).toBe(CLIENT_ID);
		expect(target.searchParams.get('redirect_uri')).toBe(
			'https://app.example.com/auth/oidc/callback'
		);
		expect(target.searchParams.get('code_challenge_method')).toBe('S256');
		expect(target.searchParams.get('state')).toBeTruthy();
		expect(target.searchParams.get('nonce')).toBeTruthy();
	}
	const flowCall = cookies.set.mock.calls.find((c) => c[0] === 'oidc_flow');
	expect(flowCall).toBeTruthy();
	expect(verifyOidcFlowCookie(flowCall![1] as string)).not.toBeNull();
});

test('start is rate limited per IP', async () => {
	configureOidc();
	const ip = '10.9.9.9';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'oidc_start');
	try {
		await startGET(mockEvent({ getClientAddress: () => ip }));
		expect.unreachable('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(429);
	}
});

test('callback rejects a state mismatch with 400', async () => {
	configureOidc();
	const flow = createOidcFlow(null);
	const cookies = {
		set: vi.fn(),
		get: vi.fn((name: string) => (name === 'oidc_flow' ? flow.cookieValue : undefined)),
		delete: vi.fn()
	};
	const url = new URL('https://app.example.com/auth/oidc/callback?code=abc&state=wrong-state');
	try {
		await callbackGET(mockEvent({ cookies, url }));
		expect.unreachable('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(400);
	}
	// The flow cookie is always cleared on callback.
	expect(cookies.delete).toHaveBeenCalledWith('oidc_flow', { path: '/' });
});

test('callback rejects a missing flow cookie with 400', async () => {
	configureOidc();
	const cookies = { set: vi.fn(), get: vi.fn(() => undefined), delete: vi.fn() };
	const flow = createOidcFlow(null);
	const url = new URL(
		`https://app.example.com/auth/oidc/callback?code=abc&state=${encodeURIComponent(flow.state)}`
	);
	try {
		await callbackGET(mockEvent({ cookies, url }));
		expect.unreachable('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(400);
	}
});

test('callback completes the flow and creates a session for a linked user', async () => {
	configureOidc();
	const user = makeUser(kitDb(), { email: 'route@x.c' });
	const flow = createOidcFlow(null);
	const now = Math.floor(Date.now() / 1000);
	const idToken = _testSignRs256(
		{ alg: 'RS256', typ: 'JWT', kid: 'route-key' },
		{
			iss: ISSUER,
			aud: CLIENT_ID,
			exp: now + 300,
			iat: now,
			nonce: flow.nonce,
			sub: 'sub-route',
			email: 'route@x.c',
			email_verified: true
		},
		privateKey
	);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/.well-known/')) return jsonResponse(DISCOVERY_DOC);
			if (url === `${ISSUER}/token`) return jsonResponse({ id_token: idToken });
			if (url === `${ISSUER}/jwks`) return jsonResponse({ keys: [jwk] });
			throw new Error(`unexpected fetch: ${url}`);
		})
	);
	const cookies = {
		set: vi.fn(),
		get: vi.fn((name: string) => (name === 'oidc_flow' ? flow.cookieValue : undefined)),
		delete: vi.fn()
	};
	const url = new URL(
		`https://app.example.com/auth/oidc/callback?code=abc&state=${encodeURIComponent(flow.state)}`
	);
	try {
		await callbackGET(mockEvent({ cookies, url }));
		expect.unreachable('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/');
	}
	expect(cookies.set).toHaveBeenCalledWith('session', expect.any(String), expect.any(Object));
	expect(user.id).toBeGreaterThan(0);
});

test('login load exposes only enabled + displayName for SSO', () => {
	configureOidc();
	const data = loginLoad({} as any) as { oidc: { enabled: boolean; displayName: string } };
	expect(data.oidc).toEqual({ enabled: true, displayName: 'Test SSO' });
	expect(JSON.stringify(data)).not.toContain(ISSUER);
});
