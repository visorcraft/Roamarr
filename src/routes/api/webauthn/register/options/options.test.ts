import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@mongreldb/kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

const passkeyMod = vi.hoisted(() => ({
	createRegistrationOptions: vi.fn(),
	isPasskeyAvailable: vi.fn(() => true)
}));
vi.mock('$lib/server/passkeys', () => passkeyMod);

import { POST } from './+server';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';
import { makeUser } from '../../../../../../tests/helpers';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function makeEvent(user: { id: number; email: string }, ip = '127.0.0.1') {
	return {
		locals: { user },
		getClientAddress: () => ip,
		request: new Request('http://localhost/api/webauthn/register/options', { method: 'POST' })
	} as any;
}

beforeEach(() => {
	resetRateLimit();
	passkeyMod.createRegistrationOptions.mockReset();
	passkeyMod.isPasskeyAvailable.mockReset().mockReturnValue(true);
});

test('returns registration options for signed-in user', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c', displayName: 'U' });
	passkeyMod.createRegistrationOptions.mockResolvedValue({ challenge: 'challenge' });
	const res = await POST(makeEvent({ id: u.id, email: u.email }));
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ challenge: 'challenge' });
	expect(passkeyMod.createRegistrationOptions).toHaveBeenCalledWith(u.id, u.email);
});

test('rejects unauthenticated callers', async () => {
	await expect(POST(makeEvent(null as any))).rejects.toMatchObject({ status: 401 });
});

test('returns 429 when rate limited', async () => {
	const u = makeUser(kitDb(), { email: 'rate@x.c', displayName: 'U' });
	const ip = '9.9.9.9';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'webauthn_register_options');
	await expect(POST(makeEvent({ id: u.id, email: u.email }, ip))).rejects.toMatchObject({ status: 429 });
});

test('returns 400 when passkeys unavailable', async () => {
	const u = makeUser(kitDb(), { email: 'nope@x.c', displayName: 'U' });
	passkeyMod.createRegistrationOptions.mockRejectedValue(new Error('ORIGIN must be set'));
	await expect(POST(makeEvent({ id: u.id, email: u.email }))).rejects.toMatchObject({ status: 400 });
});
