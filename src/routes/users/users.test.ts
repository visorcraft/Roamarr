import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

beforeEach(() => {
	ctx.kit.deleteFrom(users).executeSync();
});

afterAll(() => {
	ctx.close();
});

import { load } from './+page.server';
import { adminCreateUser, adminUpdateUser } from '$lib/server/users';
import { users } from '$lib/server/db/mongrelSchema';
import { makeAdminLocals, makeUserLocals } from '../../../tests/eventHelpers';
import { makeKitUser } from '../../../tests/kitHelpers';

test('load returns empty shape for admin', () => {
	const admin = makeAdminLocals(ctx.kit);
	const result = load({ locals: admin } as any);
	expect(result).toEqual({});
});

test('load rejects non-admin', () => {
	const u = makeUserLocals(ctx.kit);
	try {
		load({ locals: u } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
});

test('adminCreateUser rejects invalid email format', async () => {
	const admin = makeAdminLocals(ctx.kit);
	await expect(
		adminCreateUser(admin.user.id, { displayName: 'Test', email: 'not-an-email' })
	).rejects.toThrow('A valid email is required.');
});

test('adminCreateUser rejects empty email', async () => {
	const admin = makeAdminLocals(ctx.kit);
	await expect(
		adminCreateUser(admin.user.id, { displayName: 'Test', email: '   ' })
	).rejects.toThrow('A valid email is required.');
});

test('adminCreateUser rejects oversized email', async () => {
	const admin = makeAdminLocals(ctx.kit);
	await expect(
		adminCreateUser(admin.user.id, { displayName: 'Test', email: 'a'.repeat(252) + '@x.c' })
	).rejects.toThrow('A valid email is required.');
});

test('adminCreateUser rejects empty or oversized display name', async () => {
	const admin = makeAdminLocals(ctx.kit);
	await expect(
		adminCreateUser(admin.user.id, { displayName: '', email: 'test@x.c' })
	).rejects.toThrow('Display name is required');
	await expect(
		adminCreateUser(admin.user.id, { displayName: 'x'.repeat(201), email: 'test@x.c' })
	).rejects.toThrow('Display name is required');
});

function updateInput(overrides: Partial<Parameters<typeof adminUpdateUser>[2]> = {}) {
	return {
		displayName: 'Updated',
		email: 'updated@x.c',
		role: 'user' as const,
		disabled: false,
		mustResetPassword: false,
		...overrides
	};
}

test('adminUpdateUser rejects invalid email format', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const target = makeKitUser({ email: 'target@x.c', password_hash: 'x', display_name: 'Target' });
	await expect(
		adminUpdateUser(admin.user.id, Number(target.id), updateInput({ email: 'not-an-email' }))
	).rejects.toThrow('A valid email is required.');
});

test('adminUpdateUser rejects empty or oversized email', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const target = makeKitUser({ email: 'target@x.c', password_hash: 'x', display_name: 'Target' });
	await expect(
		adminUpdateUser(admin.user.id, Number(target.id), updateInput({ email: '   ' }))
	).rejects.toThrow('A valid email is required.');
	await expect(
		adminUpdateUser(admin.user.id, Number(target.id), updateInput({ email: 'a'.repeat(252) + '@x.c' }))
	).rejects.toThrow('A valid email is required.');
});

test('adminUpdateUser rejects empty or oversized display name', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const target = makeKitUser({ email: 'target@x.c', password_hash: 'x', display_name: 'Target' });
	await expect(
		adminUpdateUser(admin.user.id, Number(target.id), updateInput({ displayName: '' }))
	).rejects.toThrow('Display name is required');
	await expect(
		adminUpdateUser(admin.user.id, Number(target.id), updateInput({ displayName: 'x'.repeat(201) }))
	).rejects.toThrow('Display name is required');
});
