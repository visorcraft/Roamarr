import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({
	db: null as unknown as import('./db').DB,
	sqlite: null as unknown as any,
	kit: null as unknown as import('@mongreldb/kit').KitDatabase
}));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { requireOwnedUser, requireOwnedTrip, assertOwnedRefs, requireOwnedTripRow } from './ownership';
import { users, trips, tripHomeTasks, cards as kitCards, trips as kitTrips, users as kitUsers } from './db/mongrelSchema';
import { eq as kitEq } from '@mongreldb/kit';

import { makeKitUser } from '../../../tests/kitHelpers';
import { createTrip } from './repositories/tripsRepo';
import { createCard } from './repositories/profileRepo';

function makeTestUser(over: Partial<Record<string, unknown>> = {}) {
	const kitUser = makeKitUser({
		email: over.email as string | undefined,
		password_hash: over.passwordHash as string | undefined,
		display_name: over.displayName as string | undefined,
		role: (over.role as 'admin' | 'user') ?? 'user'
	});
	const row = ctx.kit.selectFrom(users).where(kitEq(users.id, kitUser.id)).executeSync()[0];
	return { ...(row as unknown as Record<string, unknown>), id: Number(row.id) };
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
	expect(Number(requireOwnedUser(a.id).id)).toBe(a.id);
	expect(() => requireOwnedUser(999999)).toThrow();
});

test('requireOwnedTripRow returns row owned by trip or throws 404', () => {
	const a = makeTestUser({ email: 'row@x.c' });
	const t1 = createTrip(a.id, { name: 'T1' });
	const t2 = createTrip(a.id, { name: 'T2' });
	const row = ctx.kit.insertInto(tripHomeTasks).values({ trip_id: BigInt(t1.id), text: 'A' } as never).executeSync();
	expect(Number(requireOwnedTripRow(tripHomeTasks, t1.id, Number(row.id)).id)).toBe(Number(row.id));
	expect(() => requireOwnedTripRow(tripHomeTasks, t2.id, Number(row.id))).toThrow();
	expect(() => requireOwnedTripRow(tripHomeTasks, t1.id, 999999)).toThrow();
});
