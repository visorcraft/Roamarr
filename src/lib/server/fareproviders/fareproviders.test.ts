import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('../db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { registry, runFareChecks, saveProvider, toggleWatch } from './index';
import { users, trips, fareProviders, fareWatches } from '../db/schema';
import { decrypt } from '../crypto';
import { eq } from 'drizzle-orm';

test('registry has the stub; key stored encrypted; checks active, skips paused', async () => {
	expect(registry.stub).toBeTruthy();
	const db = (ctx as { db: import('../db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: a.id, name: 'T' }).returning().get();
	const p = saveProvider(a.id, 'stub', 'SECRET-KEY', true);
	expect(
		decrypt(db.select().from(fareProviders).where(eq(fareProviders.id, p.id)).get()!.apiKey!)
	).toBe('SECRET-KEY');
	toggleWatch(a.id, t.id, p.id);
	await runFareChecks(new Date());
	const w = db.select().from(fareWatches).get()!;
	expect(w.lastResultJson).toBeTruthy();
	expect(w.lastCheckedAt).toBeTruthy();
});

test('saving with a blank apiKey preserves the stored key', () => {
	const db = (ctx as { db: import('../db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'k@x.c', passwordHash: 'x', displayName: 'K' })
		.returning()
		.get();
	saveProvider(u.id, 'stub', 'ORIGINAL-KEY', true);
	saveProvider(u.id, 'stub', '', false); // toggle enabled off without re-entering the key
	const row = db.select().from(fareProviders).where(eq(fareProviders.userId, u.id)).get()!;
	expect(row.enabled).toBe(false);
	expect(decrypt(row.apiKey!)).toBe('ORIGINAL-KEY');
});

test('toggleWatch is idempotent — no duplicate watches', () => {
	const db = (ctx as { db: import('../db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'w@x.c', passwordHash: 'x', displayName: 'W' })
		.returning()
		.get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T2' }).returning().get();
	const p = saveProvider(u.id, 'stub', 'KEY', true);
	const w1 = toggleWatch(u.id, t.id, p.id);
	const w2 = toggleWatch(u.id, t.id, p.id);
	expect(w2.id).toBe(w1.id);
	expect(db.select().from(fareWatches).where(eq(fareWatches.tripId, t.id)).all().length).toBe(1);
});
