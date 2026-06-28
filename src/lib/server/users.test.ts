import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@mongreldb/kit').KitDatabase
}));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

vi.mock('./notify', () => ({
	deliver: vi.fn(async () => {})
}));

import { createHash } from 'node:crypto';
import { eq } from '@mongreldb/kit';
import { hashPassword, verifyPassword } from './auth';
import { users, sessions } from './db/mongrelSchema';
import { makeKitUser } from '../../../tests/kitHelpers';
import { makeSyncedUser } from '../../../tests/helpers';
import {
	adminCreateUser,
	adminDeleteUser,
	adminSendPasswordReset,
	adminUpdateUser,
	completeRequiredPasswordChange,
	normalizeEmail
} from './users';
import { deliver } from './notify';

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

beforeEach(() => {
	ctx.kit.deleteFrom(sessions).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	vi.mocked(deliver).mockClear();
});

test('normalizeEmail trims and lowercases', () => {
	expect(normalizeEmail('  Admin@X.com ')).toBe('admin@x.com');
});

test('adminUpdateUser updates profile fields', async () => {
	const u = makeSyncedUser(ctx.kit, { email: 'admin@x.c', passwordHash: 'x', displayName: 'Admin', role: 'admin' });
	const target = ctx.kit
		.insertInto(users)
		.values({ email: 'target@x.c', password_hash: 'x', display_name: 'T', role: 'user' } as never)
		.executeSync();

	await adminUpdateUser(u.id, Number(target.id), {
		displayName: 'Target',
		email: 'new@x.c',
		role: 'user',
		disabled: false,
		mustResetPassword: true
	});

	const updated = ctx.kit.selectFrom(users).where(eq(users.id, BigInt(target.id))).executeSync()[0]!;
	expect(updated.display_name).toBe('Target');
	expect(updated.email).toBe('new@x.c');
	expect(updated.must_reset_password).toBe(true);
});

test('adminUpdateUser sets a new password and clears forced reset', async () => {
	const admin = makeSyncedUser(ctx.kit, { email: 'admin@x.c', passwordHash: 'x', displayName: 'Admin', role: 'admin' });
	const target = ctx.kit
		.insertInto(users)
		.values({
			email: 'target@x.c',
			password_hash: await hashPassword('oldpassword'),
			display_name: 'T',
			role: 'user',
			must_reset_password: true
		} as never)
		.executeSync();
	ctx.kit.insertInto(sessions).values({ token_hash: 'abc', user_id: BigInt(target.id), expires_at: '2099-01-01T00:00:00.000Z' } as never).executeSync();

	await adminUpdateUser(admin.id, Number(target.id), {
		displayName: 'T',
		email: 'target@x.c',
		role: 'user',
		disabled: false,
		mustResetPassword: false,
		newPassword: 'newpassword',
		confirmPassword: 'newpassword'
	});

	const updated = ctx.kit.selectFrom(users).where(eq(users.id, BigInt(target.id))).executeSync()[0]!;
	expect(await verifyPassword(updated.password_hash, 'newpassword')).toBe(true);
	expect(updated.must_reset_password).toBe(false);
	expect(ctx.kit.selectFrom(sessions).executeSync()).toHaveLength(0);
});

test('completeRequiredPasswordChange clears mustResetPassword', async () => {
	const u = makeSyncedUser(ctx.kit, {
		email: 'u@x.c',
		passwordHash: await hashPassword('oldpassword'),
		displayName: 'U',
		mustResetPassword: true
	});
	ctx.kit.insertInto(sessions).values({ token_hash: tokenHash('keep-token'), user_id: BigInt(u.id), expires_at: '2099-01-01T00:00:00.000Z' } as never).executeSync();
	ctx.kit.insertInto(sessions).values({ token_hash: tokenHash('drop-token'), user_id: BigInt(u.id), expires_at: '2099-01-01T00:00:00.000Z' } as never).executeSync();

	await completeRequiredPasswordChange(u.id, 'keep-token', 'newpassword', 'newpassword');

	const updated = ctx.kit.selectFrom(users).where(eq(users.id, BigInt(u.id))).executeSync()[0]!;
	expect(updated.must_reset_password).toBe(false);
	expect(await verifyPassword(updated.password_hash, 'newpassword')).toBe(true);
	expect(ctx.kit.selectFrom(sessions).executeSync()).toHaveLength(1);
});

test('adminCreateUser creates a user with a random password and forced reset', async () => {
	const admin = makeSyncedUser(ctx.kit, { email: 'admin@x.c', passwordHash: 'x', displayName: 'Admin', role: 'admin' });

	const { user: created, temporaryPassword } = await adminCreateUser(admin.id, {
		displayName: 'New User',
		email: 'new@x.c'
	});

	expect(created.display_name).toBe('New User');
	expect(created.email).toBe('new@x.c');
	expect(created.role).toBe('user');
	expect(created.must_reset_password).toBe(true);
	expect(temporaryPassword.length).toBeGreaterThanOrEqual(16);
	expect(await verifyPassword(created.password_hash, temporaryPassword)).toBe(true);
});

test('adminCreateUser rejects duplicate email', async () => {
	const admin = ctx.kit
		.insertInto(users)
		.values({ email: 'admin@x.c', password_hash: 'x', display_name: 'Admin', role: 'admin' } as never)
		.executeSync();
	ctx.kit.insertInto(users).values({ email: 'exists@x.c', password_hash: 'x', display_name: 'Existing' } as never).executeSync();

	await expect(
		adminCreateUser(Number(admin.id), { displayName: 'Duplicate', email: 'exists@x.c' })
	).rejects.toThrow(/already in use/i);
});

test('adminDeleteUser removes a user', async () => {
	const admin = makeSyncedUser(ctx.kit, { email: 'admin@x.c', passwordHash: 'x', displayName: 'Admin', role: 'admin' });
	const target = ctx.kit
		.insertInto(users)
		.values({ email: 'target@x.c', password_hash: 'x', display_name: 'T' } as never)
		.executeSync();

	await adminDeleteUser(admin.id, Number(target.id));

	expect(ctx.kit.selectFrom(users).where(eq(users.id, BigInt(target.id))).executeSync()[0]).toBeUndefined();
});

test('adminDeleteUser refuses to delete the last admin', async () => {
	const admin = ctx.kit
		.insertInto(users)
		.values({ email: 'admin@x.c', password_hash: 'x', display_name: 'Admin', role: 'admin' } as never)
		.executeSync();

	await expect(adminDeleteUser(Number(admin.id), Number(admin.id))).rejects.toThrow(/last admin/i);
});

test('adminSendPasswordReset sends a reset notification', async () => {
	const kitUser = makeKitUser({ email: 'target@x.c', password_hash: 'x', display_name: 'T' });
	const target = ctx.kit.selectFrom(users).where(eq(users.id, BigInt(kitUser.id))).executeSync()[0]!;

	await adminSendPasswordReset(Number(target.id), 'https://roamarr.test');
	expect(vi.mocked(deliver)).toHaveBeenCalledOnce();
	expect(vi.mocked(deliver).mock.calls[0][1].link).toMatch(/^https:\/\/roamarr\.test\/reset-password\//);
});
