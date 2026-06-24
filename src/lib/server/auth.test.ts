import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { hashPassword, verifyPassword, createSession, validateSession, invalidateSession } from './auth';
import { users, sessions } from './db/schema';

beforeEach(() => {
	(ctx as { sqlite: import('better-sqlite3').Database }).sqlite.exec(
		'delete from sessions; delete from users;'
	);
});

test('hash verifies, rejects wrong', async () => {
	const h = await hashPassword('correcthorse');
	expect(await verifyPassword(h, 'correcthorse')).toBe(true);
	expect(await verifyPassword(h, 'nope')).toBe(false);
});

test('password length is bounded', async () => {
	await expect(hashPassword('short')).rejects.toThrow();
});

test('session: raw token never stored; validates then invalidates', async () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'a@b.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const token = createSession(u.id);
	const row = db.select().from(sessions).get();
	expect(row!.tokenHash).not.toBe(token);
	expect((await validateSession(token))?.id).toBe(u.id);
	invalidateSession(token);
	expect(await validateSession(token)).toBeNull();
});
