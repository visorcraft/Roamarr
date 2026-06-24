import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({
	db: null as unknown as import('$lib/server/db').DB,
	sqlite: null as unknown as import('better-sqlite3').Database
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
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword } from './auth';
import { users, sessions } from './db/schema';
import {
	adminSendPasswordReset,
	adminUpdateUser,
	completeRequiredPasswordChange,
	normalizeEmail
} from './users';
import { deliver } from './notify';

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

beforeEach(() => {
	ctx.sqlite.exec('delete from sessions; delete from users;');
	vi.mocked(deliver).mockClear();
});

test('normalizeEmail trims and lowercases', () => {
	expect(normalizeEmail('  Admin@X.com ')).toBe('admin@x.com');
});

test('adminUpdateUser updates profile fields', async () => {
	const u = ctx.db
		.insert(users)
		.values({ email: 'admin@x.c', passwordHash: 'x', displayName: 'Admin', role: 'admin' })
		.returning()
		.get();
	const target = ctx.db
		.insert(users)
		.values({ email: 'target@x.c', passwordHash: 'x', displayName: 'T', role: 'user' })
		.returning()
		.get();

	await adminUpdateUser(u.id, target.id, {
		displayName: 'Target',
		email: 'new@x.c',
		role: 'user',
		disabled: false,
		mustResetPassword: true
	});

	const updated = ctx.db.select().from(users).where(eq(users.id, target.id)).get()!;
	expect(updated.displayName).toBe('Target');
	expect(updated.email).toBe('new@x.c');
	expect(updated.mustResetPassword).toBe(true);
});

test('adminUpdateUser sets a new password and clears forced reset', async () => {
	const admin = ctx.db
		.insert(users)
		.values({ email: 'admin@x.c', passwordHash: 'x', displayName: 'Admin', role: 'admin' })
		.returning()
		.get();
	const target = ctx.db
		.insert(users)
		.values({
			email: 'target@x.c',
			passwordHash: await hashPassword('oldpassword'),
			displayName: 'T',
			role: 'user',
			mustResetPassword: true
		})
		.returning()
		.get();
	ctx.db.insert(sessions).values({ tokenHash: 'abc', userId: target.id, expiresAt: '2099-01-01T00:00:00.000Z' }).run();

	await adminUpdateUser(admin.id, target.id, {
		displayName: 'T',
		email: 'target@x.c',
		role: 'user',
		disabled: false,
		mustResetPassword: false,
		newPassword: 'newpassword',
		confirmPassword: 'newpassword'
	});

	const updated = ctx.db.select().from(users).where(eq(users.id, target.id)).get()!;
	expect(await verifyPassword(updated.passwordHash, 'newpassword')).toBe(true);
	expect(updated.mustResetPassword).toBe(false);
	expect(ctx.db.select().from(sessions).all()).toHaveLength(0);
});

test('completeRequiredPasswordChange clears mustResetPassword', async () => {
	const u = ctx.db
		.insert(users)
		.values({
			email: 'u@x.c',
			passwordHash: await hashPassword('oldpassword'),
			displayName: 'U',
			mustResetPassword: true
		})
		.returning()
		.get();
	ctx.db.insert(sessions).values({ tokenHash: tokenHash('keep-token'), userId: u.id, expiresAt: '2099-01-01T00:00:00.000Z' }).run();
	ctx.db.insert(sessions).values({ tokenHash: tokenHash('drop-token'), userId: u.id, expiresAt: '2099-01-01T00:00:00.000Z' }).run();

	await completeRequiredPasswordChange(u.id, 'keep-token', 'newpassword', 'newpassword');

	const updated = ctx.db.select().from(users).where(eq(users.id, u.id)).get()!;
	expect(updated.mustResetPassword).toBe(false);
	expect(await verifyPassword(updated.passwordHash, 'newpassword')).toBe(true);
	expect(ctx.db.select().from(sessions).all()).toHaveLength(1);
});

test('adminSendPasswordReset sends a reset notification', async () => {
	const target = ctx.db
		.insert(users)
		.values({ email: 'target@x.c', passwordHash: 'x', displayName: 'T' })
		.returning()
		.get();

	await adminSendPasswordReset(target.id, 'https://roamarr.test');
	expect(vi.mocked(deliver)).toHaveBeenCalledOnce();
	expect(vi.mocked(deliver).mock.calls[0][1].link).toMatch(/^https:\/\/roamarr\.test\/reset-password\//);
});
