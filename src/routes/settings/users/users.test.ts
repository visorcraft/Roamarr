import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

vi.mock('$lib/server/notify', () => ({
	deliver: vi.fn(async () => {})
}));

import { load, actions } from './+page.server';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach } from 'vitest';
import { deliver } from '$lib/server/notify';
import { makeAdminLocals, makeUserLocals } from '../../../../tests/eventHelpers';
import { users as kitUsers } from '$lib/server/db/mongrelSchema';
import { makeKitUser } from '../../../../tests/kitHelpers';

beforeEach(() => {
	(ctx as any).sqlite.exec('delete from users;');
	(ctx as any).kit.deleteFrom(kitUsers).executeSync();
	vi.mocked(deliver).mockClear();
});

function updateForm(overrides: Record<string, string> = {}) {
	const form = new FormData();
	form.set('userId', overrides.userId ?? '0');
	form.set('displayName', overrides.displayName ?? 'T');
	form.set('email', overrides.email ?? 'target@x.c');
	form.set('role', overrides.role ?? 'user');
	if (overrides.enabled === 'on') form.set('enabled', 'on');
	if (overrides.mustResetPassword === 'on') form.set('mustResetPassword', 'on');
	if (overrides.newPassword) form.set('newPassword', overrides.newPassword);
	if (overrides.confirmPassword) form.set('confirmPassword', overrides.confirmPassword);
	return form;
}

test('load returns all users for admin', () => {
	const db = (ctx as any).db;
	const admin = makeAdminLocals((ctx as any).kit);
	db.insert(users).values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' }).run();
	const result = load({ locals: admin } as any) as { users: Array<{ passwordHash?: string }> };
	expect(result.users.length).toBe(2);
	expect(result.users[0]).not.toHaveProperty('passwordHash');
});

test('load rejects non-admin', () => {
	const u = makeUserLocals((ctx as any).kit);
	try {
		load({ locals: u } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
});

test('update toggles role and disabled', async () => {
	const db = (ctx as any).db;
	const admin = makeAdminLocals((ctx as any).kit);
	const target = db
		.insert(users)
		.values({ email: 'target@x.c', passwordHash: 'x', displayName: 'T', role: 'user' })
		.returning()
		.get();

	const form = updateForm({
		userId: String(target.id),
		role: 'admin',
		mustResetPassword: 'on'
	});
	try {
		await actions.update({ request: { formData: async () => form }, locals: admin, cookies: { set: vi.fn() } } as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
	}

	const updated = db.select().from(users).where(eq(users.id, target.id)).get()!;
	expect(updated.role).toBe('admin');
	expect(updated.disabled).toBe(true);
	expect(updated.mustResetPassword).toBe(true);
});

test('update changes display name and email', async () => {
	const db = (ctx as any).db;
	const admin = makeAdminLocals((ctx as any).kit);
	const target = db
		.insert(users)
		.values({ email: 'target@x.c', passwordHash: 'x', displayName: 'T', role: 'user' })
		.returning()
		.get();

	const form = updateForm({
		userId: String(target.id),
		displayName: 'Target User',
		email: 'new@x.c',
		enabled: 'on'
	});
	try {
		await actions.update({ request: { formData: async () => form }, locals: admin, cookies: { set: vi.fn() } } as any);
	} catch (e: any) {
		expect(e.status).toBe(303);
	}

	const updated = db.select().from(users).where(eq(users.id, target.id)).get()!;
	expect(updated.displayName).toBe('Target User');
	expect(updated.email).toBe('new@x.c');
	expect(updated.disabled).toBe(false);
});

test('update prevents demoting the last admin', async () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const form = updateForm({
		userId: String(admin.user.id),
		displayName: 'Admin',
		email: 'admin@x.c',
		role: 'user',
		enabled: 'on'
	});
	const result = (await actions.update({
		request: { formData: async () => form },
		locals: admin
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/last admin/i);
});

test('update prevents disabling the last admin', async () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const form = updateForm({
		userId: String(admin.user.id),
		displayName: 'Admin',
		email: 'admin@x.c',
		role: 'admin'
	});
	const result = (await actions.update({
		request: { formData: async () => form },
		locals: admin
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/last admin/i);
});

test('update rejects invalid role', async () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const target = (ctx as any).db
		.insert(users)
		.values({ email: 'target@x.c', passwordHash: 'x', displayName: 'T' })
		.returning()
		.get();
	const form = updateForm({ userId: String(target.id), role: 'superuser' });
	const result = (await actions.update({
		request: { formData: async () => form },
		locals: admin
	} as any)) as { status: number; data: { error: string } };
	expect(result.status).toBe(400);
});

test('sendReset delivers a reset link', async () => {
	const db = (ctx as any).db;
	const admin = makeAdminLocals((ctx as any).kit);
	const kitUser = makeKitUser({ email: 'target@x.c', password_hash: 'x', display_name: 'T', role: 'user' });
	const target = db.select().from(users).where(eq(users.id, Number(kitUser.id))).get()!;

	const form = new FormData();
	form.set('userId', String(target.id));
	try {
		await actions.sendReset({
			request: { formData: async () => form },
			locals: admin,
			cookies: { set: vi.fn() },
			url: new URL('https://roamarr.test/settings/users')
		} as any);
	} catch (e: any) {
		expect(e.status).toBe(303);
	}

	expect(vi.mocked(deliver)).toHaveBeenCalledOnce();
	expect(vi.mocked(deliver).mock.calls[0][1].link).toMatch(/^https:\/\/roamarr\.test\/reset-password\//);
});

test('create adds a new user with a temporary password', async () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const form = new FormData();
	form.set('displayName', 'New User');
	form.set('email', 'new@x.c');
	form.set('role', 'user');

	const result = (await actions.create({
		request: { formData: async () => form },
		locals: admin,
		cookies: { set: vi.fn() }
	} as any)) as { success: boolean; email: string; generatedPassword: string };

	expect(result.success).toBe(true);
	expect(result.email).toBe('new@x.c');
	expect(result.generatedPassword).toBeTruthy();

	const created = (ctx as any).db.select().from(users).where(eq(users.email, 'new@x.c')).get();
	expect(created.displayName).toBe('New User');
	expect(created.mustResetPassword).toBe(true);
	expect(created.role).toBe('user');
});

test('create rejects duplicate email', async () => {
	const db = (ctx as any).db;
	const admin = makeAdminLocals((ctx as any).kit);
	db.insert(users).values({ email: 'exists@x.c', passwordHash: 'x', displayName: 'Existing' }).run();

	const form = new FormData();
	form.set('displayName', 'Duplicate');
	form.set('email', 'exists@x.c');
	form.set('role', 'user');

	const result = (await actions.create({
		request: { formData: async () => form },
		locals: admin
	} as any)) as { status: number; data: { error: string } };

	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/already in use/i);
});

test('create rejects invalid role', async () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const form = new FormData();
	form.set('displayName', 'Bad Role');
	form.set('email', 'bad@x.c');
	form.set('role', 'superuser');

	const result = (await actions.create({
		request: { formData: async () => form },
		locals: admin
	} as any)) as { status: number; data: { error: string } };

	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/Invalid role/i);
});

test('delete removes a user', async () => {
	const db = (ctx as any).db;
	const admin = makeAdminLocals((ctx as any).kit);
	const target = db
		.insert(users)
		.values({ email: 'target@x.c', passwordHash: 'x', displayName: 'T', role: 'user' })
		.returning()
		.get();

	const form = new FormData();
	form.set('userId', String(target.id));
	try {
		await actions.delete({
			request: { formData: async () => form },
			locals: admin,
			cookies: { set: vi.fn() }
		} as any);
		expect.fail('should have redirected');
	} catch (e: any) {
		expect(e.status).toBe(303);
	}

	expect(db.select().from(users).where(eq(users.id, target.id)).get()).toBeUndefined();
});

test('delete prevents deleting the last admin', async () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const form = new FormData();
	form.set('userId', String(admin.user.id));

	const result = (await actions.delete({
		request: { formData: async () => form },
		locals: admin,
		cookies: { set: vi.fn() }
	} as any)) as { status: number; data: { error: string } };

	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/last admin/i);
});
