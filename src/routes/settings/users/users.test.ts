import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

vi.mock('$lib/server/notify', () => ({
	deliver: vi.fn(async () => {})
}));

import { load, actions } from './+page.server';
import { users } from '$lib/server/db/mongrelSchema';
import { eq } from '@mongreldb/kit';
import { beforeEach } from 'vitest';
import { deliver } from '$lib/server/notify';
import { makeAdminLocals, makeUserLocals } from '../../../../tests/eventHelpers';
import { makeKitUser } from '../../../../tests/kitHelpers';
import * as OTPAuth from 'otpauth';
import { generateSecret, enableTwoFactor, isTwoFactorEnabled } from '$lib/server/twoFactor';

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
	(ctx as any).kit.deleteFrom(users).executeSync();
	vi.mocked(deliver).mockClear();
});

function updateForm(overrides: Record<string, string> = {}) {
	const form = new FormData();
	form.set('userId', overrides.userId ?? '0');
	form.set('displayName', overrides.displayName ?? 'T');
	form.set('email', overrides.email ?? 'target@x.c');
	form.set('role', overrides.role ?? 'user');
	if (overrides.enabled === 'on') form.set('enabled', 'on');
	if (overrides.mustResetPassword === 'on') form.set('mustResetPassword', 'on');
	if (overrides.newPassword) form.set('newPassword', overrides.newPassword);
	if (overrides.confirmPassword) form.set('confirmPassword', overrides.confirmPassword);
	return form;
}

test('load returns all users for admin', () => {
	const kit = (ctx as any).kit;
	const admin = makeAdminLocals(kit);
	kit.insertInto(users).values({ email: 'a@x.c', password_hash: 'x', display_name: 'A' }).executeSync();
	const result = load({ locals: admin } as any) as { users: Array<{ passwordHash?: string }> };
	expect(result.users.length).toBe(2);
	expect(result.users[0]).not.toHaveProperty('passwordHash');
});

test('load rejects non-admin', () => {
	const u = makeUserLocals((ctx as any).kit);
	try {
		load({ locals: u } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
});

test('update toggles role and disabled', async () => {
	const kit = (ctx as any).kit;
	const admin = makeAdminLocals(kit);
	const target = kit
		.insertInto(users)
		.values({ email: 'target@x.c', password_hash: 'x', display_name: 'T', role: 'user' })
		.executeSync();

	const form = updateForm({
		userId: String(target.id),
		role: 'admin',
		mustResetPassword: 'on'
	});
	try {
		await actions.update({ request: { formData: async () => form }, locals: admin, cookies: { set: vi.fn() } } as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
	}

	const updated = kit.selectFrom(users).where(eq(users.id, BigInt(target.id))).executeSync()[0]!;
	expect(updated.role).toBe('admin');
	expect(updated.disabled).toBe(true);
	expect(updated.must_reset_password).toBe(true);
});

test('update changes display name and email', async () => {
	const kit = (ctx as any).kit;
	const admin = makeAdminLocals(kit);
	const target = kit
		.insertInto(users)
		.values({ email: 'target@x.c', password_hash: 'x', display_name: 'T', role: 'user' })
		.executeSync();

	const form = updateForm({
		userId: String(target.id),
		displayName: 'Target User',
		email: 'new@x.c',
		enabled: 'on'
	});
	try {
		await actions.update({ request: { formData: async () => form }, locals: admin, cookies: { set: vi.fn() } } as any);
	} catch (e: any) {
		expect(e.status).toBe(303);
	}

	const updated = kit.selectFrom(users).where(eq(users.id, BigInt(target.id))).executeSync()[0]!;
	expect(updated.display_name).toBe('Target User');
	expect(updated.email).toBe('new@x.c');
	expect(updated.disabled).toBe(false);
});

test('update prevents demoting the last admin', async () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const form = updateForm({
		userId: String(admin.user.id),
		displayName: 'Admin',
		email: 'admin@x.c',
		role: 'user',
		enabled: 'on'
	});
	const result = (await actions.update({
		request: { formData: async () => form },
		locals: admin
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/last admin/i);
});

test('update prevents disabling the last admin', async () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const form = updateForm({
		userId: String(admin.user.id),
		displayName: 'Admin',
		email: 'admin@x.c',
		role: 'admin'
	});
	const result = (await actions.update({
		request: { formData: async () => form },
		locals: admin
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/last admin/i);
});

test('update rejects invalid role', async () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const target = (ctx as any).kit
		.insertInto(users)
		.values({ email: 'target@x.c', password_hash: 'x', display_name: 'T' })
		.executeSync();
	const form = updateForm({ userId: String(target.id), role: 'superuser' });
	const result = (await actions.update({
		request: { formData: async () => form },
		locals: admin
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
});

test('sendReset delivers a reset link', async () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const target = makeKitUser({ email: 'target@x.c', password_hash: 'x', display_name: 'T', role: 'user' });

	const form = new FormData();
	form.set('userId', String(target.id));
	try {
		await actions.sendReset({
			request: { formData: async () => form },
			locals: admin,
			cookies: { set: vi.fn() },
			url: new URL('https://roamarr.test/settings/users')
		} as any);
	} catch (e: any) {
		expect(e.status).toBe(303);
	}

	expect(vi.mocked(deliver)).toHaveBeenCalledOnce();
	expect(vi.mocked(deliver).mock.calls[0][1].link).toMatch(/^https:\/\/roamarr\.test\/reset-password\//);
});

test('create adds a new user with a temporary password', async () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const form = new FormData();
	form.set('displayName', 'New User');
	form.set('email', 'new@x.c');
	form.set('role', 'user');

	const result = (await actions.create({
		request: { formData: async () => form },
		locals: admin,
		cookies: { set: vi.fn() }
	} as any)) as { success: boolean; email: string; generatedPassword: string };

	expect(result.success).toBe(true);
	expect(result.email).toBe('new@x.c');
	expect(result.generatedPassword).toBeTruthy();

	const created = (ctx as any).kit.selectFrom(users).where(eq(users.email, 'new@x.c')).executeSync()[0];
	expect(created.display_name).toBe('New User');
	expect(created.must_reset_password).toBe(true);
	expect(created.role).toBe('user');
});

test('create rejects duplicate email', async () => {
	const kit = (ctx as any).kit;
	const admin = makeAdminLocals(kit);
	kit.insertInto(users).values({ email: 'exists@x.c', password_hash: 'x', display_name: 'Existing' }).executeSync();

	const form = new FormData();
	form.set('displayName', 'Duplicate');
	form.set('email', 'exists@x.c');
	form.set('role', 'user');

	const result = (await actions.create({
		request: { formData: async () => form },
		locals: admin
	} as any)) as { status: number; data: { error: string } };

	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/already in use/i);
});

test('create rejects invalid role', async () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const form = new FormData();
	form.set('displayName', 'Bad Role');
	form.set('email', 'bad@x.c');
	form.set('role', 'superuser');

	const result = (await actions.create({
		request: { formData: async () => form },
		locals: admin
	} as any)) as { status: number; data: { error: string } };

	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/Invalid role/i);
});

test('delete removes a user', async () => {
	const kit = (ctx as any).kit;
	const admin = makeAdminLocals(kit);
	const target = kit
		.insertInto(users)
		.values({ email: 'target@x.c', password_hash: 'x', display_name: 'T', role: 'user' })
		.executeSync();

	const form = new FormData();
	form.set('userId', String(target.id));
	try {
		await actions.delete({
			request: { formData: async () => form },
			locals: admin,
			cookies: { set: vi.fn() }
		} as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
	}

	expect(kit.selectFrom(users).where(eq(users.id, BigInt(target.id))).executeSync()[0]).toBeUndefined();
});

test('delete prevents deleting the last admin', async () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const form = new FormData();
	form.set('userId', String(admin.user.id));

	const result = (await actions.delete({
		request: { formData: async () => form },
		locals: admin,
		cookies: { set: vi.fn() }
	} as any)) as { status: number; data: { error: string } };

	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/last admin/i);
});

test('disableTwoFactor removes 2FA for another user', async () => {
	const kit = (ctx as any).kit;
	const admin = makeAdminLocals(kit);
	const target = makeKitUser({ email: 'target@x.c', password_hash: 'x', display_name: 'T', role: 'user' });
	const setup = generateSecret(target.email);
	const enabled = enableTwoFactor(Number(target.id), setup.secret, validToken(setup.secret));
	expect(enabled.ok).toBe(true);
	expect(isTwoFactorEnabled(Number(target.id))).toBe(true);

	const form = new FormData();
	form.set('userId', String(target.id));
	try {
		await actions.disableTwoFactor({
			request: { formData: async () => form },
			locals: admin,
			cookies: { set: vi.fn() }
		} as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/settings/users');
	}

	expect(isTwoFactorEnabled(Number(target.id))).toBe(false);
});

test('disableTwoFactor rejects non-admins', async () => {
	const kit = (ctx as any).kit;
	const user = makeUserLocals(kit);
	const form = new FormData();
	form.set('userId', String(user.user.id));

	try {
		await actions.disableTwoFactor({
			request: { formData: async () => form },
			locals: user
		} as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
});
