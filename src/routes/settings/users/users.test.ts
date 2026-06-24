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
import { beforeEach } from 'vitest';

beforeEach(() => {
	(ctx as any).sqlite.exec('delete from users;');
});

function adminLocals() {
	const u = (ctx as any).db
		.insert(users)
		.values({ email: 'admin@x.c', passwordHash: 'x', displayName: 'Admin', role: 'admin' })
		.returning()
		.get();
	return { user: u };
}

function userLocals() {
	const u = (ctx as any).db
		.insert(users)
		.values({ email: 'user@x.c', passwordHash: 'x', displayName: 'User', role: 'user' })
		.returning()
		.get();
	return { user: u };
}

test('load returns all users for admin', () => {
	const db = (ctx as any).db;
	const admin = adminLocals();
	db.insert(users).values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' }).run();
	const result = load({ locals: admin } as any) as { users: Array<{ passwordHash?: string }> };
	expect(result.users.length).toBe(2);
	expect(result.users[0]).not.toHaveProperty('passwordHash');
});

test('load rejects non-admin', () => {
	const u = userLocals();
	try {
		load({ locals: u } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
});

test('action toggles role and disabled', async () => {
	const db = (ctx as any).db;
	const admin = adminLocals();
	const target = db
		.insert(users)
		.values({ email: 'target@x.c', passwordHash: 'x', displayName: 'T', role: 'user' })
		.returning()
		.get();

	const form = new FormData();
	form.set('userId', String(target.id));
	form.set('role', 'admin');
	form.set('disabled', 'on');
	try {
		await actions.default({ request: { formData: async () => form }, locals: admin } as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
	}

	const updated = db.select().from(users).where(eq(users.id, target.id)).get()!;
	expect(updated.role).toBe('admin');
	expect(updated.disabled).toBe(true);
});

test('action prevents demoting the last admin', async () => {
	const admin = adminLocals();
	const form = new FormData();
	form.set('userId', String(admin.user.id));
	form.set('role', 'user');
	const result = (await actions.default({
		request: { formData: async () => form },
		locals: admin
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/last admin/i);
});

test('action prevents disabling the last admin', async () => {
	const admin = adminLocals();
	const form = new FormData();
	form.set('userId', String(admin.user.id));
	form.set('role', 'admin');
	form.set('disabled', 'on');
	const result = (await actions.default({
		request: { formData: async () => form },
		locals: admin
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/last admin/i);
});

test('action rejects invalid role', async () => {
	const admin = adminLocals();
	const target = (ctx as any).db
		.insert(users)
		.values({ email: 'target@x.c', passwordHash: 'x', displayName: 'T' })
		.returning()
		.get();
	const form = new FormData();
	form.set('userId', String(target.id));
	form.set('role', 'superuser');
	const result = (await actions.default({
		request: { formData: async () => form },
		locals: admin
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
});
