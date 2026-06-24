import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { actions } from './+page.server';
import { users, trips, fareProviders, fareWatches } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

function event(user: { id: number }, body: FormData, tripId: number) {
	return {
		locals: { user } as App.Locals,
		request: { formData: async () => body } as Request,
		params: { id: String(tripId) }
	} as any;
}

test('enable action creates a watch with the chosen provider account', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'fw@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const p = db.insert(fareProviders).values({ userId: a.id, providerKey: 'stub', label: 'Work', enabled: true }).returning().get();

	const body = new FormData();
	body.set('providerId', String(p.id));
	await expect(actions.enable(event(a, body, t.id))).rejects.toEqual(expect.objectContaining({ status: 303 }));

	const w = db.select().from(fareWatches).where(eq(fareWatches.tripId, t.id)).get()!;
	expect(w.providerId).toBe(p.id);
	expect(w.status).toBe('active');
});

test('enable action is ownership-checked', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'fw-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'fw-b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const p = db.insert(fareProviders).values({ userId: a.id, providerKey: 'stub', label: 'Work', enabled: true }).returning().get();

	const body = new FormData();
	body.set('providerId', String(p.id));
	await expect(actions.enable(event(b, body, t.id))).rejects.toThrow();
});

test('pause, resume and delete actions are ownership-checked', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'fw-owner@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'fw-intruder@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const p = db.insert(fareProviders).values({ userId: a.id, providerKey: 'stub', label: 'Work', enabled: true }).returning().get();
	const w = db.insert(fareWatches).values({ tripId: t.id, providerId: p.id, status: 'active' }).returning().get();

	const pauseBody = new FormData();
	pauseBody.set('watchId', String(w.id));
	await expect(actions.pause(event(a, pauseBody, t.id))).rejects.toEqual(expect.objectContaining({ status: 303 }));
	expect(db.select().from(fareWatches).where(eq(fareWatches.id, w.id)).get()!.status).toBe('paused');

	const resumeBody = new FormData();
	resumeBody.set('watchId', String(w.id));
	await expect(actions.resume(event(a, resumeBody, t.id))).rejects.toEqual(expect.objectContaining({ status: 303 }));
	expect(db.select().from(fareWatches).where(eq(fareWatches.id, w.id)).get()!.status).toBe('active');

	await expect(actions.pause(event(b, pauseBody, t.id))).rejects.toThrow();
	await expect(actions.resume(event(b, resumeBody, t.id))).rejects.toThrow();
	await expect(actions.delete(event(b, pauseBody, t.id))).rejects.toThrow();

	const deleteBody = new FormData();
	deleteBody.set('watchId', String(w.id));
	await expect(actions.delete(event(a, deleteBody, t.id))).rejects.toEqual(expect.objectContaining({ status: 303 }));
	expect(db.select().from(fareWatches).where(eq(fareWatches.id, w.id)).get()).toBeUndefined();
});
