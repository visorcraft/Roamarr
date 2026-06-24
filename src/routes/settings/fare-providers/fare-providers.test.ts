import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { users, fareProviders } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/crypto';
import { eq } from 'drizzle-orm';

function event(user: { id: number }, body?: FormData) {
	return {
		locals: { user } as App.Locals,
		request: body ? ({ formData: async () => body } as Request) : undefined
	} as any;
}

test('load lists saved accounts without leaking ciphertext', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'fp@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	db.insert(fareProviders)
		.values({
			userId: u.id,
			providerKey: 'stub',
			label: 'Work',
			apiKey: 'encrypted-blob',
			enabled: true
		})
		.run();

	const result = load(event(u)) as any;
	expect(result.saved.length).toBe(1);
	expect(result.saved[0].label).toBe('Work');
	expect(result.saved[0].hasKey).toBe(true);
	expect(result.saved[0].apiKey).toBeUndefined();
});

test('add action creates a new provider account', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'fp-add@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();

	const body = new FormData();
	body.set('providerKey', 'stub');
	body.set('label', 'Personal');
	body.set('apiKey', 'SECRET');
	body.set('enabled', 'on');
	await expect(actions.add(event(u, body))).rejects.toEqual(expect.objectContaining({ status: 303 }));

	const row = db.select().from(fareProviders).where(eq(fareProviders.userId, u.id)).get()!;
	expect(row.label).toBe('Personal');
	expect(decrypt(row.apiKey!)).toBe('SECRET');
	expect(row.enabled).toBe(true);
});

test('update action edits an owned account', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'fp-up@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const other = db.insert(users).values({ email: 'fp-other@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const p = db.insert(fareProviders).values({ userId: u.id, providerKey: 'stub', label: 'Old', apiKey: 'enc', enabled: true }).returning().get();

	const body = new FormData();
	body.set('id', String(p.id));
	body.set('label', 'New');
	body.set('apiKey', 'NEW-SECRET');
	body.set('enabled', 'on');
	await expect(actions.update(event(u, body))).rejects.toEqual(expect.objectContaining({ status: 303 }));

	const row = db.select().from(fareProviders).where(eq(fareProviders.id, p.id)).get()!;
	expect(row.label).toBe('New');
	expect(decrypt(row.apiKey!)).toBe('NEW-SECRET');

	const hijack = new FormData();
	hijack.set('id', String(p.id));
	hijack.set('label', 'Hijacked');
	hijack.set('apiKey', 'X');
	await expect(actions.update(event(other, hijack))).rejects.toThrow();
});

test('delete action removes an owned account', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'fp-del@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const other = db.insert(users).values({ email: 'fp-del-other@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	const p = db.insert(fareProviders).values({ userId: u.id, providerKey: 'stub', label: 'X', enabled: true }).returning().get();

	const hijack = new FormData();
	hijack.set('id', String(p.id));
	await expect(actions.delete(event(other, hijack))).rejects.toThrow();

	const body = new FormData();
	body.set('id', String(p.id));
	await expect(actions.delete(event(u, body))).rejects.toEqual(expect.objectContaining({ status: 303 }));
	expect(db.select().from(fareProviders).where(eq(fareProviders.id, p.id)).get()).toBeUndefined();
});


test('test action returns the stub result without redirecting', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'fp-test@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	const p = db.insert(fareProviders).values({ userId: u.id, providerKey: 'stub', label: 'Test', apiKey: null, enabled: true }).returning().get();

	const body = new FormData();
	body.set('id', String(p.id));
	const result = (await actions.test(event(u, body))) as { testResult: string };
	expect(result.testResult).toContain('OK');
	expect(result.testResult).toContain('stub provider');
});
