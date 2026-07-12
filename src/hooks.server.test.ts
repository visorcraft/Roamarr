import { test, expect, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./lib/server/db', async () => {
	const { freshDb } = await import('../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

const bootMock = vi.hoisted(() => ({
	missingSecret: false,
	bootError: undefined as string | undefined
}));
vi.mock('./lib/server/boot', async () => ({
	bootApp: () => {},
	isMissingSecret: () => bootMock.missingSecret,
	getBootError: () => bootMock.bootError
}));

import { handle, requiredApiScope } from './hooks.server';
import { createSession, validateSession } from './lib/server/auth';
import { updateSettings } from './lib/server/settings';
import { makeKitUser } from '../tests/kitHelpers';
import { createAuthorizationCode, createClient } from './lib/server/oauth';
import { POST as tokenPost } from './routes/oauth/token/+server';

const ev = (path: string) => ({
	url: new URL('http://x' + path),
	cookies: { get: () => undefined },
	locals: {} as App.Locals,
	request: new Request('http://x' + path)
});

async function run(path: string) {
	return (handle({ event: ev(path) as any, resolve: async () => new Response('ok') }) as Promise<
		Response
	>).catch((e: any) => e);
}

test('redirects to /setup before setup is complete', async () => {
	const res: any = await run('/');
	expect(res.status).toBe(302);
	expect(res.headers.get('location')).toBe('/setup');
});

test('anonymous hitting a protected route is redirected to /login', async () => {
	updateSettings({ setupComplete: true });
	const res: any = await run('/trips');
	expect(res.status).toBe(302);
	expect(res.headers.get('location')).toBe('/login');
});

test('OAuth registration is public', async () => {
	updateSettings({ setupComplete: true });
	expect((await run('/oauth/register') as Response).status).toBe(200);
});

test('maps mobile API methods to least-privilege scopes', () => {
	expect(requiredApiScope('/api/cards', 'GET')).toBe('cards:read');
	expect(requiredApiScope('/api/cards/3', 'DELETE')).toBe('cards:write');
	expect(requiredApiScope('/api/travel-documents/3', 'PATCH')).toBe('travel-docs:write');
	expect(requiredApiScope('/api/groups', 'GET')).toBe('sharing:read');
	expect(requiredApiScope('/api/fare-watches', 'POST')).toBe('fares:write');
	expect(requiredApiScope('/api/mobile-admin', 'GET')).toBe('admin:read');
	expect(requiredApiScope('/api/webauthn/register/options', 'POST')).toBeNull();
});

test('rejects invalid bearer tokens with JSON instead of login redirect', async () => {
	updateSettings({ setupComplete: true });
	const event = ev('/api/cards');
	event.request = new Request(event.url, { headers: { authorization: 'Bearer invalid' } });
	const res = await handle({ event: event as any, resolve: async () => new Response('ok') }) as Response;
	expect(res.status).toBe(401);
	expect(await res.json()).toEqual({ error: 'Invalid or expired access token' });
});

test('authenticates valid bearer tokens and exposes their scopes', async () => {
	updateSettings({ setupComplete: true });
	const user = makeKitUser({ email: 'mobile@x.c', password_hash: 'x', display_name: 'Mobile' });
	const { client, plaintextSecret } = createClient(Number(user.id), {
		clientName: 'Mobile test', redirectUris: ['https://app.example/cb'], scopes: ['cards:read']
	});
	const verifier = randomBytes(32).toString('base64url');
	const { code } = createAuthorizationCode({
		userId: Number(user.id), clientId: client.clientId, scopes: ['cards:read'],
		codeChallenge: createHash('sha256').update(verifier).digest('base64url'), redirectUri: client.redirectUris[0]
	});
	const tokenResponse = await tokenPost({
		request: new Request('http://x/oauth/token', { method: 'POST', body: new URLSearchParams({
			grant_type: 'authorization_code', code, client_id: client.clientId,
			client_secret: plaintextSecret!, code_verifier: verifier
		}) }), getClientAddress: () => '127.0.0.1'
	} as any);
	const { access_token } = await tokenResponse.json();
	const event = ev('/api/cards');
	event.request = new Request(event.url, { headers: { authorization: `Bearer ${access_token}` } });
	const response = await handle({ event: event as any, resolve: async ({ locals }) => {
		expect(locals.user?.id).toBe(Number(user.id));
		expect(locals.oauth?.scopes).toEqual(['cards:read']);
		return new Response('ok');
	} }) as Response;
	expect(response.status).toBe(200);
	const writeEvent = ev('/api/cards/1');
	writeEvent.request = new Request(writeEvent.url, { method: 'DELETE', headers: { authorization: `Bearer ${access_token}` } });
	const denied = await handle({ event: writeEvent as any, resolve: async () => new Response('should not run') }) as Response;
	expect(denied.status).toBe(403);
	expect(await denied.json()).toEqual({ error: 'Missing required scope: cards:write' });
});

function parseCsp(header: string | null) {
	const map = new Map<string, string[]>();
	if (!header) return map;
	for (const part of header.split(';')) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const [key, ...values] = trimmed.split(/\s+/);
		map.set(key, values);
	}
	return map;
}

test('sets baseline security and CSP headers on a public response', async () => {
	updateSettings({ setupComplete: true });
	const res = (await run('/login')) as Response;
	expect(res.status).toBe(200);
	expect(res.headers.get('X-Frame-Options')).toBe('DENY');
	expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
	expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
	expect(res.headers.get('Strict-Transport-Security')).toBe(
		'max-age=63072000; includeSubDomains; preload'
	);

	const csp = res.headers.get('Content-Security-Policy');
	expect(csp).toBeTruthy();
	const parsed = parseCsp(csp);
	expect(parsed.get('default-src')).toContain("'self'");
	expect(parsed.get('script-src')).toEqual(["'self'", "'unsafe-inline'"]);
	expect(parsed.get('style-src')).toContain("'unsafe-inline'");
	expect(parsed.get('style-src')).toContain('https://fonts.googleapis.com');
	expect(parsed.get('font-src')).toContain('https://fonts.gstatic.com');
	expect(parsed.get('frame-ancestors')).toEqual(["'none'"]);
	expect(parsed.get('object-src')).toEqual(["'none'"]);
	// MapLibre needs a blob worker and the configured tile origin (default: OpenStreetMap).
	expect(parsed.get('worker-src')).toContain('blob:');
	expect(parsed.get('img-src')).toContain('blob:');
	expect(parsed.get('connect-src')).toContain('https://tile.openstreetmap.org');
});

test('sets CSP headers on a public share link', async () => {
	updateSettings({ setupComplete: true });
	const res = (await run('/share/abc123')) as Response;
	expect(res.status).toBe(200);
	expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
});

test('sets security headers on redirect responses', async () => {
	updateSettings({ setupComplete: true });
	const res = (await run('/trips')) as Response;
	expect(res.status).toBe(302);
	expect(res.headers.get('location')).toBe('/login');
	expect(res.headers.get('X-Frame-Options')).toBe('DENY');
	expect(res.headers.get('Strict-Transport-Security')).toBeTruthy();
	expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
});

test('sets security headers on error responses rendered by the app', async () => {
	updateSettings({ setupComplete: true });
	const res = (await handle({
		event: ev('/login') as any,
		resolve: async () => new Response('not found', { status: 404 })
	})) as Response;
	expect(res.status).toBe(404);
	expect(res.headers.get('X-Frame-Options')).toBe('DENY');
	expect(res.headers.get('Strict-Transport-Security')).toBeTruthy();
	expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
});

test('/health is public and not redirected before setup', async () => {
	const res = (await run('/health')) as Response;
	expect(res.status).toBe(200);
});

test('/health is public and not redirected after setup', async () => {
	updateSettings({ setupComplete: true });
	const res = (await run('/health')) as Response;
	expect(res.status).toBe(200);
});

test('/health/deep is public and not redirected before setup', async () => {
	const res = (await run('/health/deep')) as Response;
	expect(res.status).toBe(200);
});

test('/health/deep is public and not redirected after setup', async () => {
	updateSettings({ setupComplete: true });
	const res = (await run('/health/deep')) as Response;
	expect(res.status).toBe(200);
});

test('reads a flash cookie into locals and clears it', async () => {
	updateSettings({ setupComplete: true });
	const cookies = {
		get: (name: string) => (name === 'flash' ? 'Saved.' : undefined),
		set: vi.fn()
	};
	const ev = (path: string) => ({
		url: new URL('http://x' + path),
		cookies,
		locals: {} as App.Locals,
		request: new Request('http://x' + path)
	});
	const res = (await handle({
		event: ev('/login') as any,
		resolve: async (e: any) => {
			expect(e.locals.flash).toBe('Saved.');
			return new Response('ok');
		}
	})) as Response;
	expect(res.status).toBe(200);
	expect(cookies.set).toHaveBeenCalledWith('flash', '', { path: '/', maxAge: 0 });
});

test('parses a JSON flash cookie with a variant', async () => {
	updateSettings({ setupComplete: true });
	const flashPayload = JSON.stringify({ message: 'Failed.', variant: 'error' });
	const cookies = {
		get: (name: string) => (name === 'flash' ? flashPayload : undefined),
		set: vi.fn()
	};
	const ev = (path: string) => ({
		url: new URL('http://x' + path),
		cookies,
		locals: {} as App.Locals,
		request: new Request('http://x' + path)
	});
	const res = (await handle({
		event: ev('/login') as any,
		resolve: async (e: any) => {
			expect(e.locals.flash).toEqual({ message: 'Failed.', variant: 'error' });
			return new Response('ok');
		}
	})) as Response;
	expect(res.status).toBe(200);
	expect(cookies.set).toHaveBeenCalledWith('flash', '', { path: '/', maxAge: 0 });
});

test('redirects users who must reset password', async () => {
	updateSettings({ setupComplete: true });
	const u = makeKitUser({
		email: 'reset@x.c',
		password_hash: 'x',
		display_name: 'Reset',
		must_reset_password: true
	});
	expect(u.must_reset_password).toBe(true);
	const token = createSession(Number(u.id));
	expect(await validateSession(token)).toBeTruthy();
	const res: any = await Promise.resolve(
		handle({
			event: {
				url: new URL('http://x/trips'),
				cookies: { get: (name: string) => (name === 'session' ? token : undefined) },
				locals: {} as App.Locals,
				request: new Request('http://x/trips')
			} as any,
			resolve: async () => new Response('ok')
		})
	).catch((e: any) => e);
	expect(res.status).toBe(302);
	expect(res.headers.get('location')).toBe('/profile/change-password');
});

test('security invariant: boot error on a CONFIGURED instance never redirects to /setup', async () => {
	updateSettings({ setupComplete: true });
	bootMock.bootError = 'migration 99 failed: boom';
	try {
		const res: any = await run('/');
		expect(res.status).toBe(307);
		expect(res.headers.get('location')).toBe('/boot-error');

		// Even hitting /setup directly must not stay there — fall through to
		// /boot-error so the admin-creation wizard cannot be re-exposed.
		const setupRes: any = await run('/setup');
		expect(setupRes.headers.get('location')).toBe('/boot-error');
	} finally {
		bootMock.bootError = undefined;
	}
});

test('security invariant: boot error on a fresh (unconfigured) instance still uses /setup', async () => {
	updateSettings({ setupComplete: false });
	bootMock.bootError = 'migration failed during first boot';
	try {
		const res: any = await run('/');
		expect(res.status).toBe(307);
		expect(res.headers.get('location')).toBe('/setup');
	} finally {
		bootMock.bootError = undefined;
	}
});

test('security invariant: missing secret on a configured instance uses /boot-error', async () => {
	updateSettings({ setupComplete: true });
	bootMock.missingSecret = true;
	try {
		const res: any = await run('/');
		expect(res.headers.get('location')).toBe('/boot-error');
	} finally {
		bootMock.missingSecret = false;
	}
});
