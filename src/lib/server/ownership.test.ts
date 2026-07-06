import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase
}));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { requireOwnedUser, requireOwnedTrip, assertOwnedRefs } from './ownership';
import { users, trips, tripHomeTasks, cards } from './db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';

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
	ctx.kit.deleteFrom(tripHomeTasks).executeSync();
	ctx.kit.deleteFrom(cards).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
});

test('blocks cross-owner trip and card access', () => {
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
