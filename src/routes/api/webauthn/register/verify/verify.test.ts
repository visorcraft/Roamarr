import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

const passkeyMod = vi.hoisted(() => ({
	verifyRegistration: vi.fn(),
	isPasskeyAvailable: vi.fn(() => true),
	MAX_PASSKEY_NAME_LENGTH: 100
}));
vi.mock('$lib/server/passkeys', () => passkeyMod);

import { POST } from './+server';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';
import { makeUser } from '../../../../../../tests/helpers';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function makeEvent(
	user: { id: number; email: string } | null,
	body: unknown,
	opts: { ip?: string } = {}
) {
	return {
		locals: user ? { user } : {},
		getClientAddress: () => opts.ip ?? '127.0.0.1',
		request: new Request('http://localhost/api/webauthn/register/verify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as any;
}

beforeEach(() => {
	resetRateLimit();
	passkeyMod.verifyRegistration.mockReset();
	passkeyMod.isPasskeyAvailable.mockReset().mockReturnValue(true);
});

test('returns 200 on successful registration verification', async () => {
	const u = makeUser(kitDb(), { email: 'reg@x.c', displayName: 'U' });
	passkeyMod.verifyRegistration.mockResolvedValue({ ok: true });
	const res = await POST(makeEvent({ id: u.id, email: u.email }, { response: { id: 'cred' }, name: 'YubiKey' }));
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ ok: true });
	expect(passkeyMod.verifyRegistration).toHaveBeenCalledWith(u.id, { id: 'cred' }, 'YubiKey');
});

test('rejects unauthenticated callers', async () => {
	await expect(POST(makeEvent(null, { response: {} }))).rejects.toMatchObject({ status: 401 });
});

test('returns 400 when passkeys unavailable', async () => {
	const u = makeUser(kitDb(), { email: 'nope@x.c', displayName: 'U' });
	passkeyMod.isPasskeyAvailable.mockReturnValue(false);
	await expect(POST(makeEvent({ id: u.id, email: u.email }, { response: {} }))).rejects.toMatchObject({
		status: 400
	});
});

test('returns 400 when registration verification fails', async () => {
	const u = makeUser(kitDb(), { email: 'fail@x.c', displayName: 'U' });
	passkeyMod.verifyRegistration.mockResolvedValue({ ok: false, error: 'Invalid attestation' });
	await expect(POST(makeEvent({ id: u.id, email: u.email }, { response: {} }))).rejects.toMatchObject({
		status: 400
	});
});

test('returns 400 when body is missing response', async () => {
	const u = makeUser(kitDb(), { email: 'bad@x.c', displayName: 'U' });
	await expect(POST(makeEvent({ id: u.id, email: u.email }, {}))).rejects.toMatchObject({ status: 400 });
});

test('returns 429 when rate limited', async () => {
	const u = makeUser(kitDb(), { email: 'rate@x.c', displayName: 'U' });
	const ip = '9.9.9.9';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'webauthn_register_verify');
	await expect(POST(makeEvent({ id: u.id, email: u.email }, { response: {} }, { ip }))).rejects.toMatchObject({
		status: 429
	});
});
