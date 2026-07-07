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

beforeEach(() => {
	ctx.kit.deleteFrom(users).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	resetRateLimit();
});

afterAll(() => {
	ctx.close();
});

import { DELETE } from './+server';
import { users, auditLogs } from '$lib/server/db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeAdmin, makeUser } from '../../../../../tests/helpers';
import { makeUserLocals } from '../../../../../tests/eventHelpers';
import { resetRateLimit } from '$lib/server/rateLimit';

function makeEvent(params: Record<string, string>, user: unknown) {
	return {
		params,
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('delete requires admin', async () => {
	await expect(DELETE(makeEvent({ id: '1' }, null))).rejects.toMatchObject({ status: 401 });
	const user = makeUserLocals(ctx.kit);
	await expect(DELETE(makeEvent({ id: String(user.user.id) }, user.user))).rejects.toMatchObject({
		status: 403
	});
});

test('delete removes a user and returns 204', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin@x.c' });
	const target = makeUser(ctx.kit, { email: 'target@x.c', displayName: 'Target' });

	const res = await DELETE(makeEvent({ id: String(target.id) }, admin));
	expect(res.status).toBe(204);

	expect(ctx.kit.selectFrom(users).where(kitEq(users.id, BigInt(target.id))).executeSync()[0]).toBeUndefined();

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('user_delete');
	expect(Number(logs[0].entity_id)).toBe(target.id);
});

test('delete prevents deleting the last admin', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin@x.c' });

	await expect(DELETE(makeEvent({ id: String(admin.id) }, admin))).rejects.toMatchObject({
		status: 400
	});
});

test('delete rejects invalid id', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin@x.c' });
	await expect(DELETE(makeEvent({ id: 'abc' }, admin))).rejects.toMatchObject({ status: 400 });
});

test('delete returns 404 for missing user', async () => {
	const admin = makeAdmin(ctx.kit, { email: 'admin@x.c' });
	await expect(DELETE(makeEvent({ id: '99999' }, admin))).rejects.toMatchObject({
		status: 404,
		body: { message: 'User not found.' }
	});
});
