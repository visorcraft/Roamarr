import { test, expect, vi } from 'vitest';
import { eq } from '@mongreldb/kit';

const ctx = vi.hoisted(() => ({
	db: null as unknown as import('$lib/server/db').DB,
	sqlite: null as unknown as any
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { users } from '$lib/server/db/mongrelSchema';
import { hashPassword, createSession } from '$lib/server/auth';
import { beforeEach } from 'vitest';
import { makeKitUser } from '../../../../tests/kitHelpers';
import { users as kitUsers, sessions as kitSessions } from '$lib/server/db/mongrelSchema';

function kitDb() {
	return (ctx as any).kit as import('@mongreldb/kit').KitDatabase;
}

beforeEach(() => {
	(ctx as any).sqlite.exec('delete from sessions; delete from users;');
	kitDb().deleteFrom(kitUsers).executeSync();
});

test('load redirects when password change is not required', () => {
	const u = makeKitUser({ email: 'u@x.c', password_hash: 'x', display_name: 'U' });
	try {
		load({ locals: { user: ctx.db.select().from(users).get() } } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/profile');
	}
});

test('action completes a required password change', async () => {
	const u = makeKitUser({
		email: 'u@x.c',
		password_hash: await hashPassword('oldpassword'),
		display_name: 'U',
		must_reset_password: true
	});

	const token = createSession(Number(u.id));

	const form = new FormData();
	form.set('newPassword', 'newpassword');
	form.set('confirmPassword', 'newpassword');
	try {
		await actions.default({
			request: { formData: async () => form },
			locals: { user: ctx.db.select().from(users).get() },
			cookies: { get: () => token, set: vi.fn() }
		} as any);
	} catch (e: any) {
		expect(e.status).toBe(303);
	}

	const updated = ctx.db.select().from(users).where(eq(users.id, BigInt(u.id))).get()!;
	expect(updated.mustResetPassword).toBe(false);
});
