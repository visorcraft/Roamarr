import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { seedDemoData } from './seed';
import { users, trips, segments, cards, insurancePolicies, loyaltyPrograms } from './db/schema';
import { eq } from 'drizzle-orm';

test('seedDemoData creates trips, segments and cards for the admin user', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const admin = db
		.insert(users)
		.values({ email: 'admin@x.c', passwordHash: 'x', displayName: 'Admin', role: 'admin' })
		.returning()
		.get();

	seedDemoData(admin.id);

	expect(db.select().from(trips).all().length).toBeGreaterThan(0);
	expect(db.select().from(segments).all().length).toBeGreaterThan(0);
	expect(db.select().from(cards).all().length).toBeGreaterThan(0);
	expect(db.select().from(insurancePolicies).all().length).toBeGreaterThan(0);
	expect(db.select().from(loyaltyPrograms).all().length).toBeGreaterThan(0);
});

test('seedDemoData removes existing non-admin data', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const admin = db
		.insert(users)
		.values({ email: 'admin2@x.c', passwordHash: 'x', displayName: 'Admin', role: 'admin' })
		.returning()
		.get();
	const other = db.insert(users).values({ email: 'other@x.c', passwordHash: 'x', displayName: 'O' }).returning().get();
	db.insert(trips).values({ ownerId: other.id, name: 'Other Trip' }).run();

	seedDemoData(admin.id);

	expect(db.select().from(users).where(eq(users.id, other.id)).get()).toBeUndefined();
	expect(db.select().from(trips).where(eq(trips.ownerId, other.id)).get()).toBeUndefined();
	expect(db.select().from(users).where(eq(users.id, admin.id)).get()).toBeDefined();
});
