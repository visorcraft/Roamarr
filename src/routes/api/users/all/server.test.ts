import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { makeAdmin, makeUser } from '../../../../../tests/helpers';
import { users } from '$lib/server/db/mongrelSchema';
import { resetRateLimit } from '$lib/server/rateLimit';

function makeEvent(user: unknown) {
	return {
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

beforeEach(() => {
	const kit = (ctx as any).kit;
	kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

test('returns all users for admin', async () => {
	const admin = makeAdmin(ctx.kit);
	makeUser(ctx.kit, { email: 'alice@example.com', displayName: 'Alice' });
	makeUser(ctx.kit, { email: 'bob@example.com', displayName: 'Bob' });

	const res = await GET(makeEvent(admin));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.users).toHaveLength(3);
	const emails = body.users.map((u: any) => u.email).sort();
	expect(emails).toEqual(['alice@example.com', 'bob@example.com', admin.email].sort());
});

test('rejects non-admin users', async () => {
	const user = makeUser(ctx.kit);
	await expect(GET(makeEvent(user))).rejects.toMatchObject({ status: 403 });
});

test('rejects unauthenticated requests', async () => {
	await expect(GET(makeEvent(null))).rejects.toMatchObject({ status: 401 });
});

test('rate limits repeated requests', async () => {
	const admin = makeAdmin(ctx.kit);
	for (let i = 0; i < 10; i++) {
		const res = await GET(makeEvent(admin));
		expect(res.status).toBe(200);
	}
	await expect(GET(makeEvent(admin))).rejects.toMatchObject({ status: 429 });
});
