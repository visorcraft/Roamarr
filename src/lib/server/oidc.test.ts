import { test, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	_testSignRs256,
	buildAuthorizationUrl,
	clearOidcCaches,
	createOidcFlow,
	exchangeCode,
	fetchDiscovery,
	getOidcConfig,
	getOidcPublicInfo,
	normalizeDiscoveryUrl,
	oidcRedirectUri,
	parseDiscovery,
	pkceChallenge,
	resolveOidcUser,
	verifyIdToken,
	verifyOidcFlowCookie,
	type IdTokenClaims,
	type OidcDiscovery
} from './oidc';
import { getSettings, updateSettings } from './settings';
import { encrypt } from './crypto';
import { makeUser } from '../../../tests/helpers';
import * as usersRepo from './repositories/usersRepo';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

// --- RSA key fixture ---------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'test-key' } as {
	kty: string;
	kid: string;
	n: string;
	e: string;
};

const ISSUER = 'https://idp.example.com';
const CLIENT_ID = 'roamarr';
const NONCE = 'nonce-123';

const DISCOVERY: OidcDiscovery = {
	issuer: ISSUER,
	authorizationEndpoint: `${ISSUER}/authorize`,
	tokenEndpoint: `${ISSUER}/token`,
	jwksUri: `${ISSUER}/jwks`
};

function signClaims(claims: Record<string, unknown>, key = privateKey, kid: string | null = 'test-key') {
	const header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' };
	if (kid) header.kid = kid;
	return _testSignRs256(header, claims, key);
}

function validClaims(over: Record<string, unknown> = {}) {
	const now = Math.floor(Date.now() / 1000);
	return {
		iss: ISSUER,
		aud: CLIENT_ID,
		exp: now + 300,
		iat: now,
		nonce: NONCE,
		sub: 'sub-1',
		...over
	};
}

function verify(token: string, over: Partial<Parameters<typeof verifyIdToken>[1]> = {}) {
	return verifyIdToken(token, {
		issuer: ISSUER,
		clientId: CLIENT_ID,
		nonce: NONCE,
		jwks: [jwk],
		...over
	});
}

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

beforeEach(() => {
	clearOidcCaches();
});

// --- Discovery ---------------------------------------------------------------

test('normalizeDiscoveryUrl accepts base and full well-known URLs', () => {
	expect(normalizeDiscoveryUrl('https://idp.example.com')).toBe(
		'https://idp.example.com/.well-known/openid-configuration'
	);
	expect(normalizeDiscoveryUrl('https://idp.example.com/')).toBe(
		'https://idp.example.com/.well-known/openid-configuration'
	);
	expect(normalizeDiscoveryUrl('https://idp.example.com/o/app/.well-known/openid-configuration')).toBe(
		'https://idp.example.com/o/app/.well-known/openid-configuration'
	);
});

test('parseDiscovery rejects incomplete documents', () => {
	expect(() => parseDiscovery(null)).toThrow();
	expect(() => parseDiscovery({ issuer: ISSUER })).toThrow();
	expect(() =>
		parseDiscovery({
			issuer: ISSUER,
			authorization_endpoint: `${ISSUER}/authorize`,
			token_endpoint: `${ISSUER}/token`,
			jwks_uri: 'not-a-url'
		})
	).toThrow();
	const doc = parseDiscovery({
		issuer: ISSUER,
		authorization_endpoint: `${ISSUER}/authorize`,
		token_endpoint: `${ISSUER}/token`,
		jwks_uri: `${ISSUER}/jwks`
	});
	expect(doc.issuer).toBe(ISSUER);
});

test('fetchDiscovery caches results within the TTL', async () => {
	const fetchImpl = vi.fn(async () =>
		jsonResponse({
			issuer: ISSUER,
			authorization_endpoint: `${ISSUER}/authorize`,
			token_endpoint: `${ISSUER}/token`,
			jwks_uri: `${ISSUER}/jwks`
		})
	);
	const a = await fetchDiscovery(ISSUER, fetchImpl as never);
	const b = await fetchDiscovery(ISSUER, fetchImpl as never);
	expect(a).toEqual(DISCOVERY);
	expect(b).toEqual(DISCOVERY);
	expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('fetchDiscovery fails gracefully on HTTP and network errors', async () => {
	await expect(fetchDiscovery(ISSUER, (async () => jsonResponse({}, 500)) as never)).rejects.toThrow(
		/HTTP 500/
	);
	await expect(
		fetchDiscovery(ISSUER, (async () => {
			throw new Error('socket hangup');
		}) as never)
	).rejects.toThrow(/socket hangup/);
});

// --- PKCE + flow cookie ------------------------------------------------------

test('flow cookie round-trips state, nonce, verifier, and next', () => {
	const flow = createOidcFlow('/trips');
	expect(flow.state).not.toBe(flow.nonce);
	expect(pkceChallenge(flow.codeVerifier)).toMatch(/^[A-Za-z0-9_-]+$/);
	const parsed = verifyOidcFlowCookie(flow.cookieValue);
	expect(parsed).toMatchObject({
		state: flow.state,
		nonce: flow.nonce,
		codeVerifier: flow.codeVerifier,
		next: '/trips'
	});
});

test('flow cookie rejects tampering, bad signatures, and expiry', () => {
	const flow = createOidcFlow(null, 1_000);
	expect(verifyOidcFlowCookie(undefined)).toBeNull();
	expect(verifyOidcFlowCookie('garbage')).toBeNull();
	expect(verifyOidcFlowCookie(`${flow.cookieValue}x`)).toBeNull();
	const tampered = `${Buffer.from(JSON.stringify({ ...flow, state: 'evil' })).toString('base64url')}.${flow.cookieValue.split('.').pop()}`;
	expect(verifyOidcFlowCookie(tampered)).toBeNull();
	// Created at t=1000 with a 10-minute TTL: valid at t=1001, expired later.
	expect(verifyOidcFlowCookie(flow.cookieValue, 1_001)).not.toBeNull();
	expect(verifyOidcFlowCookie(flow.cookieValue, 1_000 + 601_000)).toBeNull();
});

test('buildAuthorizationUrl includes PKCE, state, and nonce', () => {
	const flow = createOidcFlow(null);
	const url = new URL(buildAuthorizationUrl(DISCOVERY, { discoveryUrl: ISSUER, clientId: CLIENT_ID, clientSecret: null, displayName: 'SSO' }, flow, 'https://app.example.com/auth/oidc/callback'));
	expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
	expect(url.searchParams.get('response_type')).toBe('code');
	expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
	expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/auth/oidc/callback');
	expect(url.searchParams.get('scope')).toBe('openid profile email');
	expect(url.searchParams.get('state')).toBe(flow.state);
	expect(url.searchParams.get('nonce')).toBe(flow.nonce);
	expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(flow.codeVerifier));
	expect(url.searchParams.get('code_challenge_method')).toBe('S256');
});

// --- Token exchange ----------------------------------------------------------

test('exchangeCode uses client_secret_basic when a secret is configured', async () => {
	const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
		const auth = (init?.headers as Record<string, string>).authorization;
		expect(auth).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:s3cret`).toString('base64')}`);
		const body = init?.body as URLSearchParams;
		expect(body.get('grant_type')).toBe('authorization_code');
		expect(body.get('code_verifier')).toBe('verifier');
		expect(body.get('client_id')).toBeNull();
		return jsonResponse({ id_token: 'id.jwt.token' });
	});
	const token = await exchangeCode(
		DISCOVERY,
		{ discoveryUrl: ISSUER, clientId: CLIENT_ID, clientSecret: 's3cret', displayName: 'SSO' },
		'code-1',
		'https://app.example.com/auth/oidc/callback',
		'verifier',
		fetchImpl as never
	);
	expect(token).toBe('id.jwt.token');
});

test('exchangeCode without a secret sends client_id in the body', async () => {
	const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
		expect((init?.headers as Record<string, string>).authorization).toBeUndefined();
		expect((init?.body as URLSearchParams).get('client_id')).toBe(CLIENT_ID);
		return jsonResponse({ id_token: 'id.jwt.token' });
	});
	await exchangeCode(
		DISCOVERY,
		{ discoveryUrl: ISSUER, clientId: CLIENT_ID, clientSecret: null, displayName: 'SSO' },
		'code-1',
		'https://app.example.com/auth/oidc/callback',
		'verifier',
		fetchImpl as never
	);
});

test('exchangeCode rejects error responses and missing id_token', async () => {
	const cfg = { discoveryUrl: ISSUER, clientId: CLIENT_ID, clientSecret: null, displayName: 'SSO' };
	await expect(
		exchangeCode(DISCOVERY, cfg, 'c', 'r', 'v', (async () => jsonResponse({}, 400)) as never)
	).rejects.toThrow(/HTTP 400/);
	await expect(
		exchangeCode(DISCOVERY, cfg, 'c', 'r', 'v', (async () => jsonResponse({ access_token: 'x' })) as never)
	).rejects.toThrow(/id_token/);
});

// --- ID token validation ------------------------------------------------------

test('verifyIdToken accepts a valid RS256 token', () => {
	const claims = verify(signClaims(validClaims()));
	expect(claims.sub).toBe('sub-1');
});

test('verifyIdToken accepts aud arrays containing the client id', () => {
	const claims = verify(signClaims(validClaims({ aud: ['other', CLIENT_ID] })));
	expect(claims.sub).toBe('sub-1');
});

test('verifyIdToken rejects wrong issuer, audience, expiry, iat, and nonce', () => {
	expect(() => verify(signClaims(validClaims({ iss: 'https://evil.example.com' })))).toThrow(/issuer/);
	expect(() => verify(signClaims(validClaims({ aud: 'someone-else' })))).toThrow(/audience/);
	const now = Math.floor(Date.now() / 1000);
	expect(() => verify(signClaims(validClaims({ exp: now - 3600 })))).toThrow(/expired/);
	expect(() => verify(signClaims(validClaims({ iat: now + 3600 })))).toThrow(/future/);
	expect(() => verify(signClaims(validClaims({ nonce: 'other-nonce' })))).toThrow(/nonce/);
	expect(() => verify(signClaims(validClaims({ sub: '' })))).toThrow(/subject/);
});

test('verifyIdToken tolerates 60s of clock skew', () => {
	const now = Math.floor(Date.now() / 1000);
	const claims = verify(signClaims(validClaims({ exp: now - 30, iat: now - 600 })));
	expect(claims.sub).toBe('sub-1');
});

test('verifyIdToken rejects alg=none and unexpected algorithms', () => {
	const noneToken = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(
		JSON.stringify(validClaims())
	).toString('base64url')}.`;
	expect(() => verify(noneToken)).toThrow(/algorithm/);
	const hsToken = `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(
		JSON.stringify(validClaims())
	).toString('base64url')}.whatever`;
	expect(() => verify(hsToken)).toThrow(/algorithm/);
});

test('verifyIdToken rejects unknown kid and bad signatures', () => {
	expect(() => verify(signClaims(validClaims(), privateKey, 'unknown-kid'))).toThrow(/unknown key/);
	const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
	expect(() => verify(signClaims(validClaims(), other.privateKey))).toThrow(/signature/);
});

test('verifyIdToken rejects malformed tokens', () => {
	expect(() => verify('not-a-jwt')).toThrow(/malformed/);
	expect(() => verify('a.b.c.d')).toThrow(/malformed/);
});

// --- User resolution -----------------------------------------------------------

function configureRegistration(allow: boolean) {
	updateSettings({ setupComplete: true, allowRegistration: allow });
}

test('links an existing user by verified email and records the sub', async () => {
	const u = makeUser(kitDb(), { email: 'sso@x.c' });
	const res = await resolveOidcUser({
		sub: 'sub-sso',
		email: 'SSO@x.c',
		email_verified: true
	} as IdTokenClaims);
	expect(res).toEqual({ ok: true, userId: u.id, outcome: 'linked' });
	expect(usersRepo.getUserById(u.id)?.oidc_sub).toBe('sub-sso');
});

test('rejects unverified email claims', async () => {
	makeUser(kitDb(), { email: 'unverified@x.c' });
	const res = await resolveOidcUser({
		sub: 'sub-unverified',
		email: 'unverified@x.c',
		email_verified: false
	} as IdTokenClaims);
	expect(res.ok).toBe(false);
	if (!res.ok) expect(res.error).toMatch(/did not verify/i);
});

test('rejects missing email claims without a linked sub', async () => {
	const res = await resolveOidcUser({ sub: 'sub-unknown' } as IdTokenClaims);
	expect(res.ok).toBe(false);
	if (!res.ok) expect(res.error).toMatch(/did not return an email/i);
});

test('falls back to the stored sub when the provider stops sending email', async () => {
	const u = makeUser(kitDb(), { email: 'subonly@x.c' });
	usersRepo.updateUser(u.id, { oidc_sub: 'sub-fallback' });
	const res = await resolveOidcUser({ sub: 'sub-fallback' } as IdTokenClaims);
	expect(res).toEqual({ ok: true, userId: u.id, outcome: 'linked_by_sub' });
});

test('rejects disabled users', async () => {
	makeUser(kitDb(), { email: 'disabled@x.c', disabled: true });
	const res = await resolveOidcUser({
		sub: 'sub-disabled',
		email: 'disabled@x.c',
		email_verified: true
	} as IdTokenClaims);
	expect(res.ok).toBe(false);
	if (!res.ok) expect(res.error).toMatch(/disabled/i);
});

test('auto-provisions only when registration is allowed', async () => {
	configureRegistration(true);
	const res = await resolveOidcUser({
		sub: 'sub-new',
		email: 'new@x.c',
		email_verified: true,
		name: 'New User'
	} as IdTokenClaims);
	expect(res.ok).toBe(true);
	if (res.ok) {
		expect(res.outcome).toBe('provisioned');
		const created = usersRepo.getUserById(res.userId)!;
		expect(created.email).toBe('new@x.c');
		expect(created.display_name).toBe('New User');
		expect(created.role).toBe('user');
		expect(created.oidc_sub).toBe('sub-new');
		expect(created.must_reset_password).toBe(false);
		// Random unusable password: a valid argon2 hash the user cannot know.
		expect(created.password_hash).toContain('$argon2');
	}
});

test('does not auto-provision when registration is closed', async () => {
	configureRegistration(false);
	const res = await resolveOidcUser({
		sub: 'sub-new-2',
		email: 'new2@x.c',
		email_verified: true
	} as IdTokenClaims);
	expect(res.ok).toBe(false);
	if (!res.ok) expect(res.error).toMatch(/registration is disabled/i);
	expect(usersRepo.getUserByEmail('new2@x.c')).toBeNull();
});

// --- Config --------------------------------------------------------------------

test('getOidcConfig decrypts the secret; public info hides it', () => {
	expect(getOidcConfig()).toBeNull();
	expect(getOidcPublicInfo()).toEqual({ enabled: false, displayName: 'SSO' });
	updateSettings({
		oidcEnabled: true,
		oidcDiscoveryUrl: ISSUER,
		oidcClientId: CLIENT_ID,
		oidcClientSecret: encrypt('top-secret'),
		oidcDisplayName: 'Authentik'
	});
	const cfg = getOidcConfig();
	expect(cfg).toMatchObject({
		discoveryUrl: ISSUER,
		clientId: CLIENT_ID,
		clientSecret: 'top-secret',
		displayName: 'Authentik'
	});
	expect(getOidcPublicInfo()).toEqual({ enabled: true, displayName: 'Authentik' });
	// The stored value stays encrypted.
	expect(getSettings().oidcClientSecret).not.toBe('top-secret');
});

test('oidcRedirectUri builds from the origin', () => {
	expect(oidcRedirectUri('https://app.example.com/')).toBe('https://app.example.com/auth/oidc/callback');
});
