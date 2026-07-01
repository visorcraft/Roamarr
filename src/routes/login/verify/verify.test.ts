import { test, expect, vi, beforeEach } from 'vitest';
import * as OTPAuth from 'otpauth';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { hashPassword } from '$lib/server/auth';
import { generateSecret, enableTwoFactor, createPendingCookie } from '$lib/server/twoFactor';
import { checkRateLimit, resetRateLimit, DEFAULT_MAX_ATTEMPTS } from '$lib/server/rateLimit';
import { makeUser } from '../../../../tests/helpers';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function validToken(secret: string): string {
	return new OTPAuth.TOTP({
		issuer: 'Roamarr',
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		secret: OTPAuth.Secret.fromBase32(secret)
	}).generate();
}

function makeCookies(value?: string) {
	return {
		get: (name: string) => (name === 'tfa_pending' ? value : undefined),
		set: vi.fn(),
		delete: vi.fn()
	};
}

beforeEach(() => {
	resetRateLimit();
});

test('load redirects when no pending 2FA cookie', () => {
	try {
		load({
			request: { headers: new Headers() },
			cookies: { get: () => undefined },
			getClientAddress: () => '1.1.1.1'
		} as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/login');
	}
});

test('load succeeds with a valid pending cookie', () => {
	const u = makeUser(kitDb());
	const cookie = createPendingCookie(u.id, '1.1.1.1', undefined).value;
	expect(
		load({
			request: { headers: new Headers() },
			cookies: makeCookies(cookie),
			getClientAddress: () => '1.1.1.1'
		} as any)
	).toEqual({});
});

test('verify action rejects missing or invalid cookies', async () => {
	try {
		await actions.default({
			request: { formData: async () => new FormData(), headers: new Headers() },
			cookies: makeCookies(undefined),
			getClientAddress: () => '1.1.1.1'
		} as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/login');
	}

	const u = makeUser(kitDb());
	const badCookie = createPendingCookie(u.id, '1.1.1.1', undefined).value.slice(0, -1) + 'x';
	try {
		await actions.default({
			request: { formData: async () => new FormData(), headers: new Headers() },
			cookies: makeCookies(badCookie),
			getClientAddress: () => '1.1.1.1'
		} as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/login');
	}
});

test('verify action accepts a TOTP code and creates a session', async () => {
	const kit = kitDb();
	const password = 'correcthorse';
	const u = makeUser(kit, { passwordHash: await hashPassword(password), email: 'u@x.c' });
	const setup = generateSecret(u.email);
	const enabled = enableTwoFactor(u.id, setup.secret, validToken(setup.secret));
	expect(enabled.ok).toBe(true);

	const cookie = createPendingCookie(u.id, '1.1.1.1', undefined).value;
	const form = new FormData();
	form.set('code', validToken(setup.secret));
	const cookies = makeCookies(cookie);

	try {
		await actions.default({
			request: { formData: async () => form, headers: new Headers() },
			cookies,
			getClientAddress: () => '1.1.1.1'
		} as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/');
	}

	expect(cookies.delete).toHaveBeenCalledWith('tfa_pending', expect.any(Object));
	expect(cookies.set).toHaveBeenCalledWith('session', expect.any(String), expect.any(Object));
});

test('verify action accepts a backup code', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'u2@x.c' });
	const setup = generateSecret(u.email);
	const enabled = enableTwoFactor(u.id, setup.secret, validToken(setup.secret));
	expect(enabled.ok).toBe(true);
	const backupCode = (enabled as any).backupCodes[0];

	const cookie = createPendingCookie(u.id, '1.1.1.1', undefined).value;
	const form = new FormData();
	form.set('code', backupCode);
	const cookies = makeCookies(cookie);

	try {
		await actions.default({
			request: { formData: async () => form, headers: new Headers() },
			cookies,
			getClientAddress: () => '1.1.1.1'
		} as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/');
	}

	expect(cookies.set).toHaveBeenCalledWith('session', expect.any(String), expect.any(Object));
});

test('verify action returns 401 for an invalid code', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'u3@x.c' });
	const setup = generateSecret(u.email);
	enableTwoFactor(u.id, setup.secret, validToken(setup.secret));

	const cookie = createPendingCookie(u.id, '1.1.1.1', undefined).value;
	const form = new FormData();
	form.set('code', '000000');
	const result = (await actions.default({
		request: { formData: async () => form, headers: new Headers() },
		cookies: makeCookies(cookie),
		getClientAddress: () => '1.1.1.1'
	} as any)) as { status: number; data: { error: string } };

	expect(result.status).toBe(401);
	expect(result.data.error).toMatch(/invalid code/i);
});

test('verify action rejects a cookie from a different IP or UA', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'u4@x.c' });
	const setup = generateSecret(u.email);
	enableTwoFactor(u.id, setup.secret, validToken(setup.secret));

	const cookie = createPendingCookie(u.id, '1.1.1.1', 'Mozilla/5.0').value;
	const form = new FormData();
	form.set('code', validToken(setup.secret));

	try {
		await actions.default({
			request: { formData: async () => form, headers: new Headers() },
			cookies: makeCookies(cookie),
			getClientAddress: () => '9.9.9.9'
		} as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/login');
	}
});

test('verify action returns 429 when rate limited', async () => {
	const ip = '9.9.9.9';
	for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) checkRateLimit(ip, 'tfa');

	const result = (await actions.default({
		request: { formData: async () => new FormData(), headers: new Headers() },
		cookies: makeCookies(createPendingCookie(1, ip, undefined).value),
		getClientAddress: () => ip
	} as any)) as { status: number; data: { error: string; retryAfter?: number } };

	expect(result.status).toBe(429);
	expect(result.data.error).toMatch(/too many/i);
	expect(result.data.retryAfter).toBeGreaterThan(0);
});
