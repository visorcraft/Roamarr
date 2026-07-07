import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

vi.mock('$lib/server/notify', () => ({
	deliver: vi.fn(async () => {})
}));

beforeEach(() => {
	ctx.kit.deleteFrom(userTwoFactor).executeSync();
	ctx.kit.deleteFrom(twoFactorBackupCodes).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { users, auditLogs, userTwoFactor, twoFactorBackupCodes } from '$lib/server/db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeAdminLocals, makeUserLocals } from '../../../../../tests/eventHelpers';
import { makeKitUser } from '../../../../../tests/kitHelpers';
import * as OTPAuth from 'otpauth';
import { generateSecret, enableTwoFactor, isTwoFactorEnabled } from '$lib/server/twoFactor';
import { deliver } from '$lib/server/notify';

function validToken(secret: string): string {
	return new OTPAuth.TOTP({
		issuer: 'Roamarr',
		algorithm: 'SHA1',
		digits: 6,
		period: 30,
		secret: OTPAuth.Secret.fromBase32(secret)
	}).generate();
}

function event(user: { id: number } | null, params: Record<string, string>, body?: FormData) {
	return {
		locals: { user } as App.Locals,
		params,
		request: body ? ({ formData: async () => body } as Request) : undefined,
		url: new URL('https://roamarr.test/users/1/edit'),
		cookies: { set: vi.fn() }
	} as any;
}

function updateForm(overrides: Record<string, string> = {}) {
	const form = new FormData();
	form.set('displayName', overrides.displayName ?? 'T');
	form.set('email', overrides.email ?? 'target@x.c');
	form.set('role', overrides.role ?? 'user');
	if (overrides.enabled === 'on') form.set('enabled', 'on');
	if (overrides.mustResetPassword === 'on') form.set('mustResetPassword', 'on');
	if (overrides.newPassword) form.set('newPassword', overrides.newPassword);
	if (overrides.confirmPassword) form.set('confirmPassword', overrides.confirmPassword);
	return form;
}

test('load requires admin', () => {
	expect(() => load(event(null, { id: '1' }))).toThrow(expect.objectContaining({ status: 401 }));
	const user = makeUserLocals(ctx.kit);
	expect(() => load(event(user.user, { id: '1' }))).toThrow(expect.objectContaining({ status: 403 }));
});

test('load returns 404 for missing user', () => {
	const admin = makeAdminLocals(ctx.kit);
	expect(() => load(event(admin.user, { id: '999' }))).toThrow(expect.objectContaining({ status: 404 }));
});

test('load returns user and two-factor status', () => {
	const admin = makeAdminLocals(ctx.kit);
	const target = makeKitUser({ email: 'target@x.c', password_hash: 'x', display_name: 'Target' });
	const setup = generateSecret(target.email);
	enableTwoFactor(Number(target.id), setup.secret, validToken(setup.secret));

	const result = load(event(admin.user, { id: String(target.id) })) as {
		user: { id: number; displayName: string };
		twoFactorEnabled: boolean;
	};

	expect(result.user.id).toBe(Number(target.id));
	expect(result.user.displayName).toBe('Target');
	expect(result.twoFactorEnabled).toBe(true);
});

test('update toggles role, disabled, and mustResetPassword', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const target = makeKitUser({ email: 'target@x.c', password_hash: 'x', display_name: 'T', role: 'user' });

	const form = updateForm({
		email: 'target@x.c',
		role: 'admin',
		mustResetPassword: 'on'
	});
	await expect(actions.update(event(admin.user, { id: String(target.id) }, form))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const updated = ctx.kit.selectFrom(users).where(kitEq(users.id, BigInt(target.id))).executeSync()[0]!;
	expect(updated.role).toBe('admin');
	expect(updated.disabled).toBe(true);
	expect(updated.must_reset_password).toBe(true);
});

test('update changes display name and email', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const target = makeKitUser({ email: 'target@x.c', password_hash: 'x', display_name: 'T', role: 'user' });

	const form = updateForm({
		displayName: 'Target User',
		email: 'new@x.c',
		role: 'user',
		enabled: 'on'
	});
	await expect(actions.update(event(admin.user, { id: String(target.id) }, form))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const updated = ctx.kit.selectFrom(users).where(kitEq(users.id, BigInt(target.id))).executeSync()[0]!;
	expect(updated.display_name).toBe('Target User');
	expect(updated.email).toBe('new@x.c');
	expect(updated.disabled).toBe(false);
});

test('update prevents demoting the last admin', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const form = updateForm({
		displayName: 'Admin',
		email: 'admin@x.c',
		role: 'user',
		enabled: 'on'
	});
	const result = (await actions.update(
		event(admin.user, { id: String(admin.user.id) }, form)
	)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/last admin/i);
});

test('update prevents disabling the last admin', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const form = updateForm({
		displayName: 'Admin',
		email: 'admin@x.c',
		role: 'admin'
	});
	const result = (await actions.update(
		event(admin.user, { id: String(admin.user.id) }, form)
	)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/last admin/i);
});

test('sendReset delivers a reset link and logs audit', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const target = makeKitUser({ email: 'target@x.c', password_hash: 'x', display_name: 'T', role: 'user' });

	await expect(actions.sendReset(event(admin.user, { id: String(target.id) }))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	expect(vi.mocked(deliver)).toHaveBeenCalledOnce();
	expect(vi.mocked(deliver).mock.calls[0][1].link).toMatch(/^https:\/\/roamarr\.test\/reset-password\//);

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('user_password_reset_sent');
	expect(Number(logs[0].entity_id)).toBe(Number(target.id));
});

test('disableTwoFactor removes 2FA for another user', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const target = makeKitUser({ email: 'target@x.c', password_hash: 'x', display_name: 'T', role: 'user' });
	const setup = generateSecret(target.email);
	const enabled = enableTwoFactor(Number(target.id), setup.secret, validToken(setup.secret));
	expect(enabled.ok).toBe(true);
	expect(isTwoFactorEnabled(Number(target.id))).toBe(true);

	await expect(actions.disableTwoFactor(event(admin.user, { id: String(target.id) }))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	expect(isTwoFactorEnabled(Number(target.id))).toBe(false);
	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs.some((l) => l.action === 'user_2fa_disabled')).toBe(true);
});
