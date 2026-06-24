import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	createPasswordResetToken,
	validatePasswordResetToken,
	consumePasswordResetToken
} from './passwordReset';
import { eq } from 'drizzle-orm';
import { users, passwordResetTokens } from './db/schema';
import { verifyPassword } from './auth';

beforeEach(() => {
	(ctx as { sqlite: import('better-sqlite3').Database }).sqlite.exec(
		'delete from password_reset_tokens; delete from users;'
	);
});

test('raw token is not stored; validate returns row', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'a@b.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const token = createPasswordResetToken(u.id);
	const row = db.select().from(passwordResetTokens).get();
	expect(row!.tokenHash).not.toBe(token);
	expect(validatePasswordResetToken(token)?.userId).toBe(u.id);
});

test('expired token is rejected and removed', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'a@b.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const token = createPasswordResetToken(u.id);
	db.update(passwordResetTokens).set({ expiresAt: '2000-01-01T00:00:00.000Z' }).run();
	expect(validatePasswordResetToken(token)).toBeNull();
	expect(db.select().from(passwordResetTokens).get()).toBeUndefined();
});

test('consume updates password and deletes tokens', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'a@b.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const token = createPasswordResetToken(u.id);
	const ok = await consumePasswordResetToken(token, 'newpassword');
	expect(ok).toBe(true);
	const updated = db.select().from(users).where(eq(users.id, u.id)).get();
	expect(await verifyPassword(updated!.passwordHash, 'newpassword')).toBe(true);
	expect(db.select().from(passwordResetTokens).get()).toBeUndefined();
});

test('consume rejects invalid token', async () => {
	const ok = await consumePasswordResetToken('not-a-token', 'newpassword');
	expect(ok).toBe(false);
});
