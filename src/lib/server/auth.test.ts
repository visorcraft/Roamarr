import { test, expect, vi, beforeEach, afterAll } from 'vitest';

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
	invalidateSession
} from './auth';
import { users, sessions } from './db/mongrelSchema';
import { makeKitUser } from '../../../tests/kitHelpers';

function resetKitTables() {
	ctx.kit.deleteFrom(sessions).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
}

beforeEach(() => {
	resetKitTables();
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
