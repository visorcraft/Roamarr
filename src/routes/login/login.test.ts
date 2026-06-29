import { test, expect, vi } from 'vitest';
import type { KitDatabase } from '@mongreldb/kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _authenticate as authenticate, actions, load } from './+page.server';
import { hashPassword } from '$lib/server/auth';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';
import { generateSecret, enableTwoFactor } from '$lib/server/twoFactor';
import * as OTPAuth from 'otpauth';
import { makeUser } from '../../../tests/helpers';

const ORIGINAL_ORIGIN = process.env.ORIGIN;

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

test('authenticate returns user on correct creds, null otherwise', async () => {
	makeUser(kitDb(), {
		email: 'a@b.c',
		passwordHash: await hashPassword('correcthorse'),
		displayName: 'A'
	});
	expect((await authenticate('A@B.c', 'correcthorse'))?.email).toBe('a@b.c');
	expect(await authenticate('a@b.c', 'wrong')).toBeNull();
});

test('authenticate rejects disabled users', async () => {
	makeUser(kitDb(), {
		email: 'disabled@b.c',
		passwordHash: await hashPassword('correcthorse'),
		displayName: 'D',
		disabled: true
	});
	expect(await authenticate('disabled@b.c', 'correcthorse')).toBeNull();
});

test('login action returns 429 when rate limited', async () => {
	resetRateLimit();
	const ip = '9.9.9.9';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'login');
	const result = (await actions.default({
		request: { formData: async () => new Map() },
		getClientAddress: () => ip,
		cookies: { set: vi.fn() }
	} as any)) as { status: number; data: { error: string; retryAfter?: number } };
	expect(result.status).toBe(429);
	expect(result.data.error).toMatch(/too many/i);
	expect(result.data.retryAfter).toBeGreaterThan(0);
});

test('load exposes passkey availability', () => {
	process.env.ORIGIN = 'https://roamarr.example.com';
	expect(load({} as any)).toEqual({ passkeyAvailable: true });
	delete process.env.ORIGIN;
	expect(load({} as any)).toEqual({ passkeyAvailable: false });
	process.env.ORIGIN = ORIGINAL_ORIGIN;
});

test('login action issues a fingerprint-bound tfa_pending cookie when 2FA is enabled', async () => {
	resetRateLimit();
	const kit = kitDb();
	const password = 'correcthorse';
	const u = makeUser(kit, { email: '2fa@x.c', passwordHash: await hashPassword(password) });
	const setup = generateSecret(u.email);
	const token = new OTPAuth.TOTP({
		issuer: 'Roamarr',
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		secret: OTPAuth.Secret.fromBase32(setup.secret)
	}).generate();
	enableTwoFactor(u.id, setup.secret, token);

	const form = new FormData();
	form.set('email', u.email);
	form.set('password', password);
	const cookies = { set: vi.fn() };

	try {
		await actions.default({
			request: {
				formData: async () => form,
				headers: new Headers({ 'user-agent': 'TestUA/1.0' })
			},
			getClientAddress: () => '1.2.3.4',
			cookies
		} as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/login/verify');
	}

	expect(cookies.set).toHaveBeenCalledWith('tfa_pending', expect.any(String), expect.any(Object));
	const pendingValue = cookies.set.mock.calls.find((c) => c[0] === 'tfa_pending')![1] as string;
	// userId.nonce.expires.fingerprint.signature
	expect(pendingValue.split('.')).toHaveLength(5);
});
