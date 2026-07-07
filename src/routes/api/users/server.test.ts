import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { makeAdmin, makeUser } from '../../../../tests/helpers';
import { userTwoFactor } from '$lib/server/db/mongrelSchema';

function makeEvent(url: string, user: unknown) {
	return {
		url: new URL(url, 'http://localhost'),
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('returns paginated users with two-factor status', async () => {
	const admin = makeAdmin(ctx.kit);
	const user = makeUser(ctx.kit, {
		email: 'alice@example.com',
		displayName: 'Alice'
	});
	(ctx.kit as any).insertInto(userTwoFactor).values({
		user_id: BigInt(user.id),
		secret_encrypted: 'enc',
		enabled: true
	} as any).executeSync();

	const res = await GET(makeEvent('/api/users', admin));
	expect(res.status).toBe(200);

	const body = await res.json();
	expect(body.total).toBe(2);
	expect(body.rows).toHaveLength(2);

	const row = body.rows.find((r: any) => r.email === 'alice@example.com');
	expect(row).toMatchObject({
		id: user.id,
		email: 'alice@example.com',
		displayName: 'Alice',
		role: 'user',
		disabled: false,
		mustResetPassword: false,
		twoFactorEnabled: true
	});
	expect(row.createdAt).toBeDefined();
});
