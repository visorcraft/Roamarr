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
import { generateSecret, enableTwoFactor, getTwoFactorState } from '$lib/server/twoFactor';
import { users, userTwoFactor, twoFactorBackupCodes } from '$lib/server/db/mongrelSchema';
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

function cookiesMock() {
	return { get: () => undefined, set: vi.fn(), delete: vi.fn(), getAll: () => [], serialize: () => '' };
}

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(userTwoFactor).executeSync();
	kit.deleteFrom(twoFactorBackupCodes).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('load returns 2FA state', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'u@x.c' });
	const result = (await load({
		locals: { user: u },
		url: new URL('http://localhost/profile/security')
	} as any)) as { state: { enabled: boolean; enabledAt: null; backupCodesRemaining: number } };
	expect(result).toEqual({ state: { enabled: false, enabledAt: null, backupCodesRemaining: 0 } });
});

test('load returns setup QR when requested', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'u@x.c' });
	const result = (await load({
		locals: { user: u },
		url: new URL('http://localhost/profile/security?setup=1')
	} as any)) as { state: { enabled: boolean }; setup: { secret: string; qr: string } };
	expect(result.state.enabled).toBe(false);
	expect(result.setup).toBeDefined();
	expect(result.setup.secret).toMatch(/^[A-Z2-7]+$/);
	expect(result.setup.qr).toMatch(/^data:image\/png;base64,/);
});

test('enable action confirms TOTP and returns backup codes', async () => {
	const kit = kitDb();
	const password = 'correcthorse';
	const u = makeUser(kit, { email: 'u@x.c', passwordHash: await hashPassword(password) });
	const setup = generateSecret(u.email);

	const form = new FormData();
	form.set('secret', setup.secret);
	form.set('token', validToken(setup.secret));

	const result = (await actions.enable({
		request: { formData: async () => form },
		locals: { user: u },
		cookies: cookiesMock()
	} as any)) as { backupCodes: string[] };

	expect(result.backupCodes).toHaveLength(10);
	expect(getTwoFactorState(u.id).enabled).toBe(true);
});

test('enable action rejects an invalid TOTP', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'u2@x.c' });
	const setup = generateSecret(u.email);

	const form = new FormData();
	form.set('secret', setup.secret);
	form.set('token', '000000');

	const result = (await actions.enable({
		request: { formData: async () => form },
		locals: { user: u },
		cookies: cookiesMock()
	} as any)) as { status: number; data: { error: string } };

	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/invalid/i);
});

test('disable action requires password and a valid second factor', async () => {
	const kit = kitDb();
	const password = 'correcthorse';
	const u = makeUser(kit, { email: 'u3@x.c', passwordHash: await hashPassword(password) });
	const setup = generateSecret(u.email);
	enableTwoFactor(u.id, setup.secret, validToken(setup.secret));

	// Wrong password
	const wrongPassword = new FormData();
	wrongPassword.set('password', 'wrong');
	wrongPassword.set('totpCode', validToken(setup.secret));
	const r1 = (await actions.disable({
		request: { formData: async () => wrongPassword },
		locals: { user: u },
		cookies: cookiesMock()
	} as any)) as { status: number; data: { error: string } };
	expect(r1.status).toBe(401);
	expect(getTwoFactorState(u.id).enabled).toBe(true);

	// Wrong TOTP
	const wrongCode = new FormData();
	wrongCode.set('password', password);
	wrongCode.set('totpCode', '000000');
	const r2 = (await actions.disable({
		request: { formData: async () => wrongCode },
		locals: { user: u },
		cookies: cookiesMock()
	} as any)) as { status: number; data: { error: string } };
	expect(r2.status).toBe(401);
	expect(getTwoFactorState(u.id).enabled).toBe(true);

	// Correct password + TOTP
	const good = new FormData();
	good.set('password', password);
	good.set('totpCode', validToken(setup.secret));
	try {
		await actions.disable({
			request: { formData: async () => good },
			locals: { user: u },
			cookies: cookiesMock()
		} as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/profile/security');
	}
	expect(getTwoFactorState(u.id).enabled).toBe(false);
});

test('disable action accepts a backup code as second factor', async () => {
	const kit = kitDb();
	const password = 'correcthorse';
	const u = makeUser(kit, { email: 'u4@x.c', passwordHash: await hashPassword(password) });
	const setup = generateSecret(u.email);
	const enabled = enableTwoFactor(u.id, setup.secret, validToken(setup.secret));
	expect(enabled.ok).toBe(true);
	const backupCode = (enabled as any).backupCodes[0];

	const form = new FormData();
	form.set('password', password);
	form.set('totpCode', backupCode);
	try {
		await actions.disable({
			request: { formData: async () => form },
			locals: { user: u },
			cookies: cookiesMock()
		} as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
	}
	expect(getTwoFactorState(u.id).enabled).toBe(false);
});

test('regenerate action requires a valid TOTP and replaces backup codes', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'u5@x.c' });
	const setup = generateSecret(u.email);
	const enabled = enableTwoFactor(u.id, setup.secret, validToken(setup.secret));
	expect(enabled.ok).toBe(true);
	const oldCodes = (enabled as any).backupCodes;

	// Bad code
	const bad = new FormData();
	bad.set('token', '000000');
	const r1 = (await actions.regenerate({
		request: { formData: async () => bad },
		locals: { user: u },
		cookies: cookiesMock()
	} as any)) as { status: number; data: { error: string } };
	expect(r1.status).toBe(400);

	// Good code
	const good = new FormData();
	good.set('token', validToken(setup.secret));
	const result = (await actions.regenerate({
		request: { formData: async () => good },
		locals: { user: u },
		cookies: cookiesMock()
	} as any)) as { backupCodes: string[] };

	expect(result.backupCodes).toHaveLength(10);
	expect(result.backupCodes).not.toEqual(oldCodes);
});

test('2FA setup UI uses theme tokens instead of hard-coded palette colors', async () => {
	const { readFile } = await import('node:fs/promises');
	const source = await readFile(
		new URL('./+page.svelte', import.meta.url),
		'utf-8'
	);
	const hardCodedPalette = [
		'text-green-400',
		'bg-green-400',
		'text-red-400',
		'border-red-500/30',
		'border-slate-200',
		'border-slate-700',
		'bg-slate-100',
		'bg-slate-800'
	];
	for (const cls of hardCodedPalette) {
		expect(source).not.toContain(cls);
	}
	expect(source).toContain('text-brand');
	expect(source).toContain('bg-brand');
	expect(source).toContain('border-line');
	expect(source).toContain('bg-surface2');
});
