import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { createTrip, loadTripFor } from './shared';
import { load } from './+page.server';
import { users, trips, groups, groupMembers, tripShares } from '$lib/server/db/schema';

test('owner sees full trip; non-owner without share is blocked', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
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
	const t = createTrip(a.id, { name: 'Trip', defaultVisibility: 'public' });
	expect(t.publicToken).toBeTruthy();
	expect(loadTripFor(a.id, t.id).owner).toBe(true);
	expect(() => loadTripFor(b.id, t.id)).toThrow();
});

test('trip list includes shared trips and labels them shared', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'list-a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'list-b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const c = db.insert(users).values({ email: 'list-c@x.c', passwordHash: 'x', displayName: 'C' }).returning().get();

	const owned = db
		.insert(trips)
		.values({ ownerId: a.id, name: 'Owned Trip', destination: 'Paris', startDate: '2026-07-01', notes: 'OWNER NOTE' })
		.returning()
		.get();

	const shared = db
		.insert(trips)
		.values({ ownerId: a.id, name: 'Shared Trip', destination: 'Tokyo', startDate: '2026-08-01', notes: 'SECRET' })
		.returning()
		.get();
	db.insert(tripShares).values({ tripId: shared.id, sharedWithUserId: b.id }).run();

	const groupTrip = db
		.insert(trips)
		.values({ ownerId: a.id, name: 'Group Trip', destination: 'Berlin', startDate: '2026-09-01' })
		.returning()
		.get();
	const g = db.insert(groups).values({ ownerId: a.id, name: 'fam' }).returning().get();
	db.insert(groupMembers).values({ groupId: g.id, userId: c.id }).run();
	db.insert(tripShares).values({ tripId: groupTrip.id, sharedWithGroupId: g.id }).run();

	function locals(user: { id: number }) {
		return { user } as App.Locals;
	}

	const forB = load({ locals: locals(b) } as any) as any;
	expect(forB.trips.map((t: any) => t.name)).toEqual(['Shared Trip']);
	expect(forB.trips[0].isShared).toBe(true);
	expect(JSON.stringify(forB.trips)).not.toContain('SECRET');

	const forC = load({ locals: locals(c) } as any) as any;
	expect(forC.trips.map((t: any) => t.name)).toEqual(['Group Trip']);
	expect(forC.trips[0].isShared).toBe(true);

	const forA = load({ locals: locals(a) } as any) as any;
	expect(forA.trips.map((t: any) => t.name).sort()).toEqual(['Group Trip', 'Owned Trip', 'Shared Trip']);
	expect(forA.trips.find((t: any) => t.name === 'Owned Trip')?.isShared).toBe(false);
	expect(forA.trips.find((t: any) => t.name === 'Owned Trip')?.defaultVisibility).toBe('private');
});
