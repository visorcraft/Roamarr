import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('../db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	registry,
	runFareChecks,
	createProvider,
	updateProvider,
	deleteProvider,
	toggleWatch,
	pauseWatch,
	resumeWatch,
	deleteWatch
} from './index';
import { users, trips, fareProviders, fareWatches } from '../db/schema';
import { decrypt } from '../crypto';
import { eq } from 'drizzle-orm';

test('registry has the stub; key stored encrypted; checks active, skips paused', async () => {
	expect(registry.stub).toBeTruthy();
	const db = (ctx as { db: import('../db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'fare-a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const p = createProvider(a.id, 'stub', 'Work', 'SECRET-KEY', true);
	expect(p.label).toBe('Work');
	expect(
		decrypt(db.select().from(fareProviders).where(eq(fareProviders.id, p.id)).get()!.apiKey!)
	).toBe('SECRET-KEY');
	toggleWatch(a.id, t.id, p.id);
	await runFareChecks(new Date());
	const w = db.select().from(fareWatches).get()!;
	expect(w.lastResultJson).toBeTruthy();
	expect(w.lastCheckedAt).toBeTruthy();
});

test('user can save multiple accounts per provider', () => {
	const db = (ctx as { db: import('../db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'fare-multi@x.c', passwordHash: 'x', displayName: 'M' })
		.returning()
		.get();
	const a = createProvider(u.id, 'stub', 'Personal', 'KEY-A', true);
	const b = createProvider(u.id, 'stub', 'Work', 'KEY-B', true);
	expect(a.id).not.toBe(b.id);
	const rows = db
		.select()
		.from(fareProviders)
		.where(eq(fareProviders.userId, u.id))
		.all();
	expect(rows).toHaveLength(2);
	expect(rows.map((r) => r.label).sort()).toEqual(['Personal', 'Work']);
});

test('updating with a blank apiKey preserves the stored key', () => {
	const db = (ctx as { db: import('../db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'fare-k@x.c', passwordHash: 'x', displayName: 'K' })
		.returning()
		.get();
	const p = createProvider(u.id, 'stub', 'Original', 'ORIGINAL-KEY', true);
	updateProvider(u.id, p.id, 'Renamed', '', false); // toggle enabled off without re-entering the key
	const row = db.select().from(fareProviders).where(eq(fareProviders.id, p.id)).get()!;
	expect(row.label).toBe('Renamed');
	expect(row.enabled).toBe(false);
	expect(decrypt(row.apiKey!)).toBe('ORIGINAL-KEY');
});

test('provider mutations are owner-checked', () => {
	const db = (ctx as { db: import('../db').DB }).db;
	const a = db.insert(users).values({ email: 'fare-own@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'fare-other@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const p = createProvider(a.id, 'stub', 'Mine', 'KEY', true);

	expect(() => updateProvider(b.id, p.id, 'Hijacked', 'X', true)).toThrow();
	expect(() => deleteProvider(b.id, p.id)).toThrow();

	deleteProvider(a.id, p.id);
	expect(db.select().from(fareProviders).where(eq(fareProviders.id, p.id)).get()).toBeUndefined();
});

test('toggleWatch is idempotent — no duplicate watches', () => {
	const db = (ctx as { db: import('../db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'fare-w@x.c', passwordHash: 'x', displayName: 'W' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T2' }).returning().get();
	const p = createProvider(u.id, 'stub', 'Primary', 'KEY', true);
	const w1 = toggleWatch(u.id, t.id, p.id);
	const w2 = toggleWatch(u.id, t.id, p.id);
	expect(w2.id).toBe(w1.id);
	expect(db.select().from(fareWatches).where(eq(fareWatches.tripId, t.id)).all().length).toBe(1);
});

test('pauseWatch, resumeWatch and deleteWatch are owner-checked', () => {
	const db = (ctx as { db: import('../db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'fare-owner@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'fare-other2@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T3' }).returning().get();
	const p = createProvider(a.id, 'stub', 'Primary', 'KEY', true);
	const w = toggleWatch(a.id, t.id, p.id);

	expect(pauseWatch(a.id, w.id).status).toBe('paused');
	expect(resumeWatch(a.id, w.id).status).toBe('active');

	expect(() => pauseWatch(b.id, w.id)).toThrow();
	expect(() => resumeWatch(b.id, w.id)).toThrow();
	expect(() => deleteWatch(b.id, w.id)).toThrow();

	deleteWatch(a.id, w.id);
	expect(db.select().from(fareWatches).where(eq(fareWatches.id, w.id)).get()).toBeUndefined();
});

test('runFareChecks skips paused watches and disabled providers', async () => {
	const db = (ctx as { db: import('../db').DB }).db;

	const a = db
		.insert(users)
		.values({ email: 'fare-skip-paused@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const t1 = db.insert(trips).values({ ownerId: a.id, name: 'Paused' }).returning().get();
	const p1 = createProvider(a.id, 'stub', 'A', 'K1', true);
	const wPaused = toggleWatch(a.id, t1.id, p1.id);
	pauseWatch(a.id, wPaused.id);

	const b = db
		.insert(users)
		.values({ email: 'fare-skip-disabled@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const t2 = db.insert(trips).values({ ownerId: b.id, name: 'Disabled' }).returning().get();
	const p2 = createProvider(b.id, 'stub', 'B', 'K2', true);
	updateProvider(b.id, p2.id, 'B', '', false); // disable provider without changing key
	const wDisabled = toggleWatch(b.id, t2.id, p2.id);

	await runFareChecks(new Date());

	const r1 = db.select().from(fareWatches).where(eq(fareWatches.id, wPaused.id)).get()!;
	const r2 = db.select().from(fareWatches).where(eq(fareWatches.id, wDisabled.id)).get()!;
	expect(r1.lastCheckedAt).toBeNull();
	expect(r2.lastCheckedAt).toBeNull();
});
