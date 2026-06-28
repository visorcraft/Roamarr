import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({
	db: null as unknown as import('./db').DB,
	sqlite: null as unknown as import('better-sqlite3').Database,
	kit: null as unknown as import('@mongreldb/kit').KitDatabase
}));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { requireOwnedUser, requireOwnedTrip, assertOwnedRefs, requireOwnedTripRow } from './ownership';
import { users, trips, tripHomeTasks } from './db/schema';
import { eq } from 'drizzle-orm';
import {
	cards as kitCards,
	trips as kitTrips,
	users as kitUsers
} from './db/mongrelSchema';
import { makeKitUser } from '../../../tests/kitHelpers';
import { createTrip } from './repositories/tripsRepo';
import { createCard } from './repositories/profileRepo';

function makeTestUser(over: Partial<typeof users.$inferInsert> = {}) {
	const db = (ctx as { db: import('./db').DB }).db;
	const kitUser = makeKitUser({
		email: over.email,
		password_hash: over.passwordHash,
		display_name: over.displayName,
		role: (over.role as 'admin' | 'user') ?? 'user'
	});
	return db.select().from(users).where(eq(users.id, Number(kitUser.id))).get()!;
}

beforeEach(() => {
	ctx.sqlite.exec('delete from trip_home_tasks; delete from trips; delete from cards; delete from users;');
	ctx.kit.deleteFrom(kitCards).executeSync();
	ctx.kit.deleteFrom(kitTrips).executeSync();
	ctx.kit.deleteFrom(kitUsers).executeSync();
});

test('blocks cross-owner trip and card access', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = makeTestUser({ email: 'a@x.c' });
	const b = makeTestUser({ email: 'b@x.c' });
	const tA = createTrip(a.id, { name: 'A trip' });
	const cA = createCard(a.id, { nickname: 'A card', network: 'visa' });
	expect(requireOwnedTrip(a.id, tA.id).id).toBe(tA.id);
	expect(() => requireOwnedTrip(b.id, tA.id)).toThrow();
	expect(() => assertOwnedRefs(b.id, { cardId: cA.id })).toThrow();
	expect(() => assertOwnedRefs(a.id, { cardId: cA.id })).not.toThrow();
});

test('requireOwnedUser returns the user row or throws', () => {
	const a = makeTestUser({ email: 'u@x.c' });
	expect(requireOwnedUser(a.id).id).toBe(a.id);
	expect(() => requireOwnedUser(999999)).toThrow();
});

test('requireOwnedTripRow returns row owned by trip or throws 404', () => {
	const a = makeTestUser({ email: 'row@x.c' });
	const t1 = createTrip(a.id, { name: 'T1' });
	const t2 = createTrip(a.id, { name: 'T2' });
	const row = ctx.db.insert(tripHomeTasks).values({ tripId: t1.id, text: 'A' }).returning().get();
	expect(requireOwnedTripRow(tripHomeTasks, t1.id, row.id).id).toBe(row.id);
	expect(() => requireOwnedTripRow(tripHomeTasks, t2.id, row.id)).toThrow();
	expect(() => requireOwnedTripRow(tripHomeTasks, t1.id, 999999)).toThrow();
});
