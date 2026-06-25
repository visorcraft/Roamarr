import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { requireOwnedUser, requireOwnedTrip, assertOwnedRefs, requireOwnedTripRow } from './ownership';
import { users, trips, cards, tripHomeTasks } from './db/schema';

test('blocks cross-owner trip and card access', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' })
		.returning()
		.get();
	const b = db
		.insert(users)
		.values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' })
		.returning()
		.get();
	const tA = db.insert(trips).values({ ownerId: a.id, name: 'A trip' }).returning().get();
	const cA = db
		.insert(cards)
		.values({ userId: a.id, nickname: 'A card', network: 'visa' })
		.returning()
		.get();
	expect(requireOwnedTrip(a.id, tA.id).id).toBe(tA.id);
	expect(() => requireOwnedTrip(b.id, tA.id)).toThrow();
	expect(() => assertOwnedRefs(b.id, { cardId: cA.id })).toThrow();
	expect(() => assertOwnedRefs(a.id, { cardId: cA.id })).not.toThrow();
});

test('requireOwnedUser returns the user row or throws', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = db
		.insert(users)
		.values({ email: 'u@x.c', passwordHash: 'x', displayName: 'U' })
		.returning()
		.get();
	expect(requireOwnedUser(a.id).id).toBe(a.id);
	expect(() => requireOwnedUser(999999)).toThrow();
});

test('requireOwnedTripRow returns row owned by trip or throws 404', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const a = db.insert(users).values({ email: 'row@x.c', passwordHash: 'x', displayName: 'R' }).returning().get();
	const t1 = db.insert(trips).values({ ownerId: a.id, name: 'T1' }).returning().get();
	const t2 = db.insert(trips).values({ ownerId: a.id, name: 'T2' }).returning().get();
	const row = db.insert(tripHomeTasks).values({ tripId: t1.id, text: 'A' }).returning().get();
	expect(requireOwnedTripRow(tripHomeTasks, t1.id, row.id).id).toBe(row.id);
	expect(() => requireOwnedTripRow(tripHomeTasks, t2.id, row.id)).toThrow();
	expect(() => requireOwnedTripRow(tripHomeTasks, t1.id, 999999)).toThrow();
});
