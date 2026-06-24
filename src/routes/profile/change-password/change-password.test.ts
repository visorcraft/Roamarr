import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword, createSession } from '$lib/server/auth';
import { beforeEach } from 'vitest';

beforeEach(() => {
	(ctx as any).sqlite.exec('delete from sessions; delete from users;');
});

test('load redirects when password change is not required', () => {
	const u = ctx.db
		.insert(users)
		.values({ email: 'u@x.c', passwordHash: 'x', displayName: 'U' })
		.returning()
		.get();
	try {
		load({ locals: { user: u } } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(303);
		expect(e.location).toBe('/profile');
	}
});

test('action completes a required password change', async () => {
	const u = ctx.db
		.insert(users)
		.values({
			email: 'u@x.c',
			passwordHash: await hashPassword('oldpassword'),
			displayName: 'U',
			mustResetPassword: true
		})
		.returning()
		.get();

	const token = createSession(u.id);

	const form = new FormData();
	form.set('newPassword', 'newpassword');
	form.set('confirmPassword', 'newpassword');
	try {
		await actions.default({
			request: { formData: async () => form },
			locals: { user: u },
			cookies: { get: () => token, set: vi.fn() }
		} as any);
	} catch (e: any) {
		expect(e.status).toBe(303);
	}

	const updated = ctx.db.select().from(users).where(eq(users.id, u.id)).get()!;
	expect(updated.mustResetPassword).toBe(false);
});
