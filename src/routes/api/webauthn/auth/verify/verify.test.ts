import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

const passkeyMod = vi.hoisted(() => ({
	verifyAuth: vi.fn(),
	isPasskeyAvailable: vi.fn(() => true)
}));
vi.mock('$lib/server/passkeys', () => passkeyMod);

const authMod = vi.hoisted(() => ({
	createSession: vi.fn(() => 'session-token'),
	sessionCookieOptions: vi.fn(() => ({ path: '/', httpOnly: true, secure: false, sameSite: 'lax' as const }))
}));
vi.mock('$lib/server/auth', () => authMod);

import { POST } from './+server';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';

function makeEvent(body: unknown, opts: { ip?: string } = {}) {
	return {
		request: new Request('http://localhost/api/webauthn/auth/verify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => opts.ip ?? '127.0.0.1',
		cookies: { set: vi.fn() }
	} as any;
}

beforeEach(() => {
	resetRateLimit();
	passkeyMod.verifyAuth.mockReset();
	passkeyMod.isPasskeyAvailable.mockReset().mockReturnValue(true);
	authMod.createSession.mockReset().mockReturnValue('session-token');
	authMod.sessionCookieOptions.mockReset().mockReturnValue({
		path: '/',
		httpOnly: true,
		secure: false,
		sameSite: 'lax' as const
	});
});

test('creates session on successful passkey authentication', async () => {
	passkeyMod.verifyAuth.mockResolvedValue({ ok: true, userId: 42 });
	const res = await POST(makeEvent({ id: 'cred', response: {} }));
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ ok: true });
	expect(authMod.createSession).toHaveBeenCalledWith(42, '127.0.0.1', undefined);
});

test('returns 401 when verification fails', async () => {
	passkeyMod.verifyAuth.mockResolvedValue({ ok: false, error: 'Unknown credential' });
	await expect(POST(makeEvent({ id: 'cred', response: {} }))).rejects.toMatchObject({ status: 401 });
});

test('returns 400 when passkeys unavailable', async () => {
	passkeyMod.isPasskeyAvailable.mockReturnValue(false);
	await expect(POST(makeEvent({ id: 'cred', response: {} }))).rejects.toMatchObject({ status: 400 });
});

test('returns 429 when rate limited', async () => {
	const ip = '9.9.9.9';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'webauthn_auth');
	await expect(POST(makeEvent({ id: 'cred', response: {} }, { ip }))).rejects.toMatchObject({ status: 429 });
});
