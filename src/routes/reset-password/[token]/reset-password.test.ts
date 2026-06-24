import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { eq } from 'drizzle-orm';
import { createPasswordResetToken } from '$lib/server/passwordReset';
import { users } from '$lib/server/db/schema';
import { verifyPassword } from '$lib/server/auth';

function makeEvent(token: string, formData?: Map<string, string>) {
	return {
		params: { token },
		request: { formData: async () => formData ?? new Map() }
	} as any;
}

beforeEach(() => {
	(ctx as { sqlite: import('better-sqlite3').Database }).sqlite.exec(
		'delete from password_reset_tokens; delete from users;'
	);
});

test('load returns token for valid reset link, 404 for invalid', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'a@b.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const token = createPasswordResetToken(u.id);
	expect(load(makeEvent(token))).toEqual({ token });
	expect(() => load(makeEvent('bad-token'))).toThrow(expect.objectContaining({ status: 404 }));
});

test('action rejects short or mismatched passwords', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'a@b.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const token = createPasswordResetToken(u.id);
	const short = (await actions.default(
		makeEvent(token, new Map([['password', 'short'], ['confirmPassword', 'short']]))
	)) as { status: number; data: { error: string } };
	expect(short.status).toBe(400);
	expect(short.data.error).toMatch(/at least 8/i);
	const mismatch = (await actions.default(
		makeEvent(token, new Map([['password', 'longenough'], ['confirmPassword', 'different']]))
	)) as { status: number; data: { error: string } };
	expect(mismatch.status).toBe(400);
	expect(mismatch.data.error).toMatch(/do not match/i);
});

test('action consumes token, updates password, and redirects', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'a@b.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const token = createPasswordResetToken(u.id);
	await expect(
		actions.default(makeEvent(token, new Map([['password', 'newpassword'], ['confirmPassword', 'newpassword']])))
	).rejects.toEqual(expect.objectContaining({ status: 303, location: '/login' }));
	const updated = db.select().from(users).where(eq(users.id, u.id)).get();
	expect(await verifyPassword(updated!.passwordHash, 'newpassword')).toBe(true);
});
