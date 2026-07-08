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
import {
	users,
	userTwoFactor,
	twoFactorBackupCodes,
	passkeys,
	oauthClients,
	oauthTokens
} from '$lib/server/db/mongrelSchema';
import { makeUser } from '../../../../tests/helpers';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function cookiesMock() {
	return { get: () => undefined, set: vi.fn(), delete: vi.fn(), getAll: () => [], serialize: () => '' };
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

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(oauthTokens).executeSync();
	kit.deleteFrom(oauthClients).executeSync();
	kit.deleteFrom(passkeys).executeSync();
	kit.deleteFrom(twoFactorBackupCodes).executeSync();
	kit.deleteFrom(userTwoFactor).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('load returns security data', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'u@x.c' });
	const result = (await load({
		locals: { user: u },
		url: new URL('http://localhost/profile/security')
	} as any)) as {
		state: { enabled: boolean };
		setup: { secret: string; qr: string };
		passkeys: unknown[];
		clients: unknown[];
		tokens: unknown[];
		allScopes: string[];
	};
	expect(result.state.enabled).toBe(false);
	expect(result.setup.secret).toMatch(/^[A-Z2-7]+$/);
	expect(result.setup.qr).toMatch(/^data:image\/png;base64,/);
	expect(result.passkeys).toEqual([]);
	expect(result.clients).toEqual([]);
	expect(result.tokens).toEqual([]);
	expect(result.allScopes.length).toBeGreaterThan(0);
});

test('updatePassword action changes password and redirects', async () => {
	const kit = kitDb();
	const initialHash = await hashPassword('oldsecret');
	const u = makeUser(kit, { email: 'pw@x.c', passwordHash: initialHash });
	const cookies = { set: vi.fn(), get: () => 'current-token' };
	const form = new FormData();
	form.set('oldPassword', 'oldsecret');
	form.set('newPassword', 'newsecret1');
	form.set('confirmPassword', 'newsecret1');

	await expect(
		actions.updatePassword({ request: { formData: async () => form }, locals: { user: u }, cookies } as any)
	).rejects.toMatchObject({
		status: 303,
		location: '/profile/security?tab=password'
	});
	expect(cookies.set).toHaveBeenCalledWith('flash', 'Password changed.', expect.any(Object));
});

test('enable action confirms TOTP and returns backup codes', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'u@x.c' });
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
	expect(result.backupCodes.every((c) => /^[0-9a-f]{4}-[0-9a-f]{4}$/.test(c))).toBe(true);
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
		expect(e.location).toBe('/profile/security?tab=2fa');
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

	const bad = new FormData();
	bad.set('token', '000000');
	const r1 = (await actions.regenerate({
		request: { formData: async () => bad },
		locals: { user: u },
		cookies: cookiesMock()
	} as any)) as { status: number; data: { error: string } };
	expect(r1.status).toBe(400);

	const good = new FormData();
	good.set('token', validToken(setup.secret));
	const result = (await actions.regenerate({
		request: { formData: async () => good },
		locals: { user: u },
		cookies: cookiesMock()
	} as any)) as { backupCodes: string[] };

	expect(result.backupCodes).toHaveLength(10);
	expect(result.backupCodes.every((c) => /^[0-9a-f]{4}-[0-9a-f]{4}$/.test(c))).toBe(true);
	expect(result.backupCodes).not.toEqual(oldCodes);
});

test('renamePasskey and deletePasskey actions manage passkeys', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'pk@x.c', passwordHash: await hashPassword('longsecret') });
	const inserted = kit
		.insertInto(passkeys)
		.values({
			user_id: BigInt(u.id),
			credential_id: 'cred1',
			public_key: 'pk1',
			name: 'Old name'
		} as any)
		.executeSync();

	const renameForm = new FormData();
	renameForm.set('id', String(inserted.id));
	renameForm.set('name', 'New name');
	await expect(
		actions.renamePasskey({
			request: { formData: async () => renameForm },
			locals: { user: u },
			cookies: cookiesMock()
		} as any)
	).rejects.toMatchObject({
		status: 303,
		location: '/profile/security?tab=passkeys'
	});

	const deleteForm = new FormData();
	deleteForm.set('id', String(inserted.id));
	await expect(
		actions.deletePasskey({
			request: { formData: async () => deleteForm },
			locals: { user: u },
			cookies: cookiesMock()
		} as any)
	).rejects.toMatchObject({
		status: 303,
		location: '/profile/security?tab=passkeys'
	});
});

test('createClient, deleteClient and revokeToken actions manage OAuth clients and tokens', async () => {
	const kit = kitDb();
	const u = makeUser(kit, { email: 'oauth@x.c' });

	const createForm = new FormData();
	createForm.set('clientName', 'Test client');
	createForm.set('redirectUris', 'http://localhost/callback');
	createForm.append('scopes', 'trips:read');
	const created = (await actions.createClient({
		request: { formData: async () => createForm },
		locals: { user: u },
		cookies: cookiesMock()
	} as any)) as { clientId: string; clientSecret: string };
	expect(created.clientId).toBeDefined();
	expect(created.clientSecret).toBeDefined();

	const token = kit
		.insertInto(oauthTokens)
		.values({
			access_token_hash: 'hash',
			client_id: created.clientId,
			user_id: BigInt(u.id),
			scopes: 'trips:read',
			expires_at: new Date(Date.now() + 3600000).toISOString()
		} as any)
		.executeSync();

	const revokeForm = new FormData();
	revokeForm.set('tokenId', String(token.id));
	await expect(
		actions.revokeToken({
			request: { formData: async () => revokeForm },
			locals: { user: u },
			cookies: cookiesMock()
		} as any)
	).rejects.toMatchObject({
		status: 303,
		location: '/profile/security?tab=api-clients'
	});

	const deleteForm = new FormData();
	deleteForm.set('clientId', created.clientId);
	await expect(
		actions.deleteClient({
			request: { formData: async () => deleteForm },
			locals: { user: u },
			cookies: cookiesMock()
		} as any)
	).rejects.toMatchObject({
		status: 303,
		location: '/profile/security?tab=api-clients'
	});
});

test('2FA UI uses theme tokens instead of hard-coded palette colors', async () => {
	const { readFile } = await import('node:fs/promises');
	const source = await readFile(new URL('./+page.svelte', import.meta.url), 'utf-8');
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

test('backup-code UI requires an explicit saved acknowledgment', async () => {
	const { readFile } = await import('node:fs/promises');
	const source = await readFile(new URL('./+page.svelte', import.meta.url), 'utf-8');
	expect(source).toContain('I saved these backup codes');
	expect(source).toContain('bind:checked={savedAck}');
	expect(source).toContain('aria-disabled={!savedAck}');
});
