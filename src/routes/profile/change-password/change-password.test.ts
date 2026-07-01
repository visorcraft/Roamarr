import { test, expect, vi } from 'vitest';
import { eq } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { users, sessions } from '$lib/server/db/mongrelSchema';
import { hashPassword, createSession } from '$lib/server/auth';
import { beforeEach } from 'vitest';
import { makeKitUser } from '../../../../tests/kitHelpers';

function kitDb(): import('@visorcraft/mongreldb-kit').KitDatabase {
	return (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
}

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(sessions).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('load redirects when password change is not required', () => {
	const kit = kitDb();
	makeKitUser({ email: 'u@x.c', password_hash: 'x', display_name: 'U' });
	try {
		load({ locals: { user: kit.selectFrom(users).executeSync()[0] } } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/profile');
	}
});

test('action completes a required password change', async () => {
	const kit = kitDb();
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
			locals: { user: kit.selectFrom(users).executeSync()[0] },
			cookies: { get: () => token, set: vi.fn() }
		} as any);
	} catch (e: any) {
		expect(e.status).toBe(303);
	}

	const updated = kit.selectFrom(users).where(eq(users.id, u.id)).executeSync()[0]!;
	expect(updated.must_reset_password).toBe(false);
});
