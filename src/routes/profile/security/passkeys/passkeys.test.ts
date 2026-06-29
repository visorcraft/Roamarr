import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@mongreldb/kit';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { passkeys } from '$lib/server/db/mongrelSchema';
import { makeUser } from '../../../../../tests/helpers';
import { MAX_PASSKEY_NAME_LENGTH } from '$lib/server/passkeys';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function makeLocals(user: { id: number; passwordHash: string }) {
	return { user } as App.Locals;
}

function makeCookies() {
	return { set: vi.fn(), delete: vi.fn(), get: vi.fn(), getAll: vi.fn(), serialize: vi.fn() };
}

function makeRequest(record: Record<string, string>) {
	const form = new FormData();
	for (const [k, v] of Object.entries(record)) form.set(k, v);
	return { formData: async () => form } as any;
}

beforeEach(() => {
	process.env.ORIGIN = 'https://roamarr.example.com';
});

test('load returns passkeys and availability', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c', displayName: 'U', passwordHash: 'x' });
	const result = (await load({ locals: makeLocals(u) } as any)) as {
		passkeys: unknown[];
		available: boolean;
	};
	expect(result.passkeys).toEqual([]);
	expect(result.available).toBe(true);
});

test('rename action fails on nonexistent passkey', async () => {
	const u = makeUser(kitDb(), { email: 'rename1@x.c', displayName: 'U', passwordHash: 'x' });
	const result = await actions.rename({
		request: makeRequest({ id: '999', name: 'New Name' }),
		locals: makeLocals(u),
		cookies: makeCookies()
	} as any);
	expect((result as any).status).toBe(400);
	expect((result as any).data.error).toMatch(/not found/i);
});

test('rename action caps name length', async () => {
	const u = makeUser(kitDb(), { email: 'rename2@x.c', displayName: 'U', passwordHash: 'x' });
	const inserted = kitDb().insertInto(passkeys).values({
		user_id: BigInt(u.id),
		credential_id: 'cred',
		public_key: 'dGVzdA==',
		counter: 0n,
		transports: '[]',
		device_type: 'singleDevice',
		name: 'Old',
		created_at: new Date().toISOString(),
		last_used_at: null
	} as any).executeSync();

	const longName = 'a'.repeat(MAX_PASSKEY_NAME_LENGTH + 10);
	const result = await actions.rename({
		request: makeRequest({ id: String(inserted.id), name: longName }),
		locals: makeLocals(u),
		cookies: makeCookies()
	} as any);
	expect((result as any).status).toBe(400);
	expect((result as any).data.error).toMatch(/too long/i);
});

test('delete action fails on nonexistent passkey', async () => {
	const u = makeUser(kitDb(), { email: 'delete1@x.c', displayName: 'U', passwordHash: 'x' });
	const result = await actions.delete({
		request: makeRequest({ id: '999' }),
		locals: makeLocals(u),
		cookies: makeCookies()
	} as any);
	expect((result as any).status).toBe(400);
	expect((result as any).data.error).toMatch(/not found/i);
});

test('delete action blocks last-credential lockout', async () => {
	const u = makeUser(kitDb(), { email: 'delete2@x.c', displayName: 'U', passwordHash: '' });
	const inserted = kitDb().insertInto(passkeys).values({
		user_id: BigInt(u.id),
		credential_id: 'only-cred',
		public_key: 'dGVzdA==',
		counter: 0n,
		transports: '[]',
		device_type: 'singleDevice',
		name: 'Only',
		created_at: new Date().toISOString(),
		last_used_at: null
	} as any).executeSync();

	const result = await actions.delete({
		request: makeRequest({ id: String(inserted.id) }),
		locals: makeLocals(u),
		cookies: makeCookies()
	} as any);
	expect((result as any).status).toBe(400);
	expect((result as any).data.error).toMatch(/last credential/i);
});
