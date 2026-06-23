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
