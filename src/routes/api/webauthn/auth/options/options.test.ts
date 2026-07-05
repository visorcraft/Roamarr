import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

const passkeyMod = vi.hoisted(() => ({
	createAuthOptions: vi.fn(),
	isPasskeyAvailable: vi.fn(() => true)
}));
vi.mock('$lib/server/passkeys', () => passkeyMod);

import { POST } from './+server';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';

function makeEvent(opts: { ip?: string } = {}) {
	return {
		getClientAddress: () => opts.ip ?? '127.0.0.1',
		request: new Request('http://localhost/api/webauthn/auth/options', { method: 'POST' })
	} as any;
}

beforeEach(() => {
	resetRateLimit();
	passkeyMod.createAuthOptions.mockReset();
	passkeyMod.isPasskeyAvailable.mockReset().mockReturnValue(true);
});

test('returns authentication options when passkeys are available', async () => {
	passkeyMod.createAuthOptions.mockResolvedValue({
		challenge: 'auth-challenge',
		rpId: 'localhost',
		allowCredentials: [],
		userVerification: 'preferred'
	});
	const res = await POST(makeEvent());
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({
		challenge: 'auth-challenge',
		rpId: 'localhost',
		allowCredentials: [],
		userVerification: 'preferred'
	});
	expect(passkeyMod.createAuthOptions).toHaveBeenCalledTimes(1);
});

test('returns 400 when passkeys are unavailable', async () => {
	passkeyMod.isPasskeyAvailable.mockReturnValue(false);
	await expect(POST(makeEvent())).rejects.toMatchObject({ status: 400 });
	expect(passkeyMod.createAuthOptions).not.toHaveBeenCalled();
});

test('returns 400 when ORIGIN is unset', async () => {
	passkeyMod.createAuthOptions.mockRejectedValue(new Error('ORIGIN must be set to use passkeys'));
	await expect(POST(makeEvent())).rejects.toMatchObject({ status: 400 });
});

test('returns 429 when rate limited', async () => {
	const ip = '9.9.9.9';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'webauthn_auth');
	await expect(POST(makeEvent({ ip }))).rejects.toMatchObject({ status: 429 });
});
