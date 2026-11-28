import { test, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

const ctx = vi.hoisted(
	() =>
		({
			kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
			close: null as unknown as () => void
		} as {
			kit: import('@visorcraft/mongreldb-kit').KitDatabase;
			close: () => void;
		})
);
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

import {
	hashPassword,
	verifyPassword,
	createSession,
	validateSession,
	invalidateSession,
	sessionCookieOptions,
	updateSessionMetadata,
	SESSION_RENEWAL_THRESHOLD_MS
} from './auth';
import * as usersRepo from './repositories/usersRepo';
import { users, sessions } from './db/mongrelSchema';
import { updateSettings } from './settings';
import { makeKitUser } from '../../../tests/kitHelpers';

function resetKitTables() {
	ctx.kit.deleteFrom(sessions).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
}

beforeEach(() => {
	resetKitTables();
});

afterEach(() => {
	updateSettings({ sessionCookieSameSite: 'lax' });
});

afterAll(() => {
	ctx.close();
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
	const u = makeKitUser({ email: 'a@b.c' });
	const token = createSession(Number(u.id));
	const row = ctx.kit.selectFrom(sessions).executeSync()[0];
	expect(row!.token_hash).not.toBe(token);
	expect((await validateSession(token))?.id).toBe(Number(u.id));
	invalidateSession(token);
	expect(await validateSession(token)).toBeNull();
});

test('validateSession rejects disabled users', async () => {
	const u = makeKitUser({ email: 'd@b.c', disabled: true });
	const token = createSession(Number(u.id));
	expect(await validateSession(token)).toBeNull();
});

test('createSession stores IP and user agent metadata', () => {
	const u = makeKitUser({ email: 'm@b.c' });
	createSession(Number(u.id), '127.0.0.1', 'TestAgent/1.0');
	const row = ctx.kit.selectFrom(sessions).executeSync()[0];
	expect(row!.last_ip).toBe('127.0.0.1');
	expect(row!.user_agent).toBe('TestAgent/1.0');
});

test('sessionCookieOptions defaults to lax', () => {
	expect(sessionCookieOptions().sameSite).toBe('lax');
});

test('sessionCookieOptions reflects settings value', () => {
	updateSettings({ sessionCookieSameSite: 'strict' });
	expect(sessionCookieOptions().sameSite).toBe('strict');
	updateSettings({ sessionCookieSameSite: 'lax' });
	expect(sessionCookieOptions().sameSite).toBe('lax');
});

test('updateSessionMetadata skips DB writes when metadata unchanged and expiry fresh', () => {
	expect(SESSION_RENEWAL_THRESHOLD_MS).toBeGreaterThan(0);
	const u = makeKitUser({ email: 'meta@b.c' });
	const token = createSession(Number(u.id), '127.0.0.1', 'TestAgent/1.0');
	const spy = vi.spyOn(usersRepo, 'updateSessionByTokenHash');
	try {
		expect(updateSessionMetadata(token, '127.0.0.1', 'TestAgent/1.0')).toBe(false);
		expect(spy).not.toHaveBeenCalled();

		expect(updateSessionMetadata(token, '10.0.0.2', 'TestAgent/1.0')).toBe(false);
		expect(spy).toHaveBeenCalledTimes(1);
		const row = ctx.kit.selectFrom(sessions).executeSync()[0];
		expect(row!.last_ip).toBe('10.0.0.2');
	} finally {
		spy.mockRestore();
	}
});

test('updateSessionMetadata extends expires_at when remaining lifetime is below renewal threshold', () => {
	const u = makeKitUser({ email: 'renew@b.c' });
	const token = createSession(Number(u.id), '127.0.0.1', 'TestAgent/1.0');
	ctx.kit
		.updateTable(sessions)
		.set({ expires_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() })
		.executeSync();

	expect(updateSessionMetadata(token, '127.0.0.1', 'TestAgent/1.0')).toBe(true);

	const row = ctx.kit.selectFrom(sessions).executeSync()[0];
	expect(new Date(String(row!.expires_at)).getTime()).toBeGreaterThan(Date.now() + 25 * 24 * 60 * 60 * 1000);
});


