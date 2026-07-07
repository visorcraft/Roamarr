import { test, expect, vi, beforeEach, afterAll } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

vi.mock('$lib/server/notify', () => ({
	deliver: vi.fn(async () => {})
}));

beforeEach(() => {
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import { users } from '$lib/server/db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeAdminLocals, makeUserLocals } from '../../../../tests/eventHelpers';
import { resetRateLimit } from '$lib/server/rateLimit';

function event(user: { id: number } | null, body?: FormData) {
	return {
		locals: { user } as App.Locals,
		request: body ? ({ formData: async () => body } as Request) : undefined,
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('load requires admin', () => {
	expect(() => load(event(null))).toThrow(expect.objectContaining({ status: 401 }));
	const user = makeUserLocals(ctx.kit);
	expect(() => load(event(user.user))).toThrow(expect.objectContaining({ status: 403 }));
});

test('create adds a new user with a temporary password', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const form = new FormData();
	form.set('displayName', 'New User');
	form.set('email', 'new@x.c');
	form.set('role', 'user');

	const result = (await actions.create(event(admin.user, form))) as {
		success: boolean;
		email: string;
		generatedPassword: string;
	};

	expect(result.success).toBe(true);
	expect(result.email).toBe('new@x.c');
	expect(result.generatedPassword).toBeTruthy();

	const created = ctx.kit.selectFrom(users).where(kitEq(users.email, 'new@x.c')).executeSync()[0];
	expect(created.display_name).toBe('New User');
	expect(created.must_reset_password).toBe(true);
	expect(created.role).toBe('user');
});

test('create rejects invalid role', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const form = new FormData();
	form.set('displayName', 'Bad Role');
	form.set('email', 'bad@x.c');
	form.set('role', 'superuser');

	const result = (await actions.create(event(admin.user, form))) as {
		status: number;
		data: { error: string };
	};

	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/Invalid role/i);
});

test('create rejects duplicate email', async () => {
	const admin = makeAdminLocals(ctx.kit);
	ctx.kit.insertInto(users).values({ email: 'exists@x.c', password_hash: 'x', display_name: 'Existing' }).executeSync();

	const form = new FormData();
	form.set('displayName', 'Duplicate');
	form.set('email', 'exists@x.c');
	form.set('role', 'user');

	const result = (await actions.create(event(admin.user, form))) as {
		status: number;
		data: { error: string };
	};

	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/already in use/i);
});

test('create rejects invalid email format', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const form = new FormData();
	form.set('displayName', 'Bad Email');
	form.set('email', 'not-an-email');
	form.set('role', 'user');

	const result = (await actions.create(event(admin.user, form))) as {
		status: number;
		data: { error: string };
	};

	expect(result.status).toBe(400);
	expect(result.data.error).toBe('A valid email is required.');
});

test('create rejects oversized email and display name', async () => {
	const admin = makeAdminLocals(ctx.kit);
	const form = new FormData();
	form.set('displayName', 'x'.repeat(201));
	form.set('email', 'a'.repeat(252) + '@x.c');
	form.set('role', 'user');

	const result = (await actions.create(event(admin.user, form))) as {
		status: number;
		data: { error: string };
	};

	expect(result.status).toBe(400);
	expect(result.data.error).toMatch(/email|display name/i);
});
