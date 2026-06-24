import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import { users, trips, groups, groupMembers, tripShares, travelDocuments, notifications, fareProviders, fareWatches } from '$lib/server/db/schema';

function locals(user: { id: number }) {
	return { user } as App.Locals;
}

test('dashboard includes upcoming trips shared with the user and labels them shared', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = db.insert(users).values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const b = db.insert(users).values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const c = db.insert(users).values({ email: 'c@x.c', passwordHash: 'x', displayName: 'C' }).returning().get();

	const future = '2026-07-01';
	const past = '2026-01-01';

	// Owned by A, shared directly with B
	const shared = db
		.insert(trips)
		.values({ ownerId: a.id, name: 'Shared Trip', destination: 'Paris', startDate: future, notes: 'SECRET' })
		.returning()
		.get();
	db.insert(tripShares).values({ tripId: shared.id, sharedWithUserId: b.id }).run();

	// Owned by A, shared with group containing C
	const groupShared = db
		.insert(trips)
		.values({ ownerId: a.id, name: 'Group Trip', destination: 'Tokyo', startDate: future })
		.returning()
		.get();
	const g = db.insert(groups).values({ ownerId: a.id, name: 'fam' }).returning().get();
	db.insert(groupMembers).values({ groupId: g.id, userId: c.id }).run();
	db.insert(tripShares).values({ tripId: groupShared.id, sharedWithGroupId: g.id }).run();

	// Owned by A, not shared
	db.insert(trips)
		.values({ ownerId: a.id, name: 'Private Trip', destination: 'Berlin', startDate: future })
		.run();

	// Past shared trip should not appear in upcoming list
	db.insert(trips)
		.values({ ownerId: a.id, name: 'Past Shared', destination: 'Rome', startDate: past })
		.run();
	db.insert(tripShares).values({ tripId: 4, sharedWithUserId: b.id }).run();

	const forB = load({ locals: locals(b) } as any) as any;
	expect(forB.upcoming.map((t: any) => t.name)).toEqual(['Shared Trip']);
	expect(forB.upcoming[0].isShared).toBe(true);
	expect(JSON.stringify(forB.upcoming)).not.toContain('SECRET');

	const forC = load({ locals: locals(c) } as any) as any;
	expect(forC.upcoming.map((t: any) => t.name)).toEqual(['Group Trip']);
	expect(forC.upcoming[0].isShared).toBe(true);

	const forA = load({ locals: locals(a) } as any) as any;
	expect(forA.upcoming.map((t: any) => t.name).sort()).toEqual(['Group Trip', 'Private Trip', 'Shared Trip']);
	expect(forA.upcoming.every((t: any) => t.isShared === false)).toBe(true);
});


test('dashboard uses user document expiry lead', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'lead@x.c', passwordHash: 'x', displayName: 'U', documentExpiryLeadDays: 30 })
		.returning()
		.get();
	// Expires in 60 days, outside the 30-day lead window
	db.insert(travelDocuments).values({ userId: u.id, type: 'passport', expiresOn: '2026-08-24' }).run();
	const data = load({ locals: locals(u) } as any) as any;
	expect(data.expiring).toHaveLength(0);
});

test('dashboard stats reflect unread notifications, expiring docs and fare watches', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'stats@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	db.insert(notifications).values({ userId: u.id, title: 'A', body: 'B' }).run();
	db.insert(travelDocuments).values({ userId: u.id, type: 'passport', expiresOn: '2026-06-25' }).run();

	const fp = db.insert(fareProviders).values({ userId: u.id, providerKey: 'stub', label: 'S' }).returning().get();
	const t = db.insert(trips).values({ ownerId: u.id, name: 'T', startDate: '2026-07-01' }).returning().get();
	db.insert(fareWatches).values({ tripId: t.id, providerId: fp.id }).run();

	const data = load({ locals: locals(u) } as any) as any;
	expect(data.stats.upcoming).toBe(1);
	expect(data.stats.unread).toBe(1);
	expect(data.stats.expiring).toBe(1);
	expect(data.stats.watches).toBe(1);
});
