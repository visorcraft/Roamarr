import { test, expect, vi, afterEach } from 'vitest';

afterEach(() => {
	vi.useRealTimers();
});

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import { users, trips, groups, groupMembers, tripShares, segments, travelDocuments, notifications, fareProviders, fareWatches } from '$lib/server/db/schema';
import { makeLocals } from '../../tests/eventHelpers';

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

	const forB = load({ locals: makeLocals(b) } as any) as any;
	expect(forB.upcoming.map((t: any) => t.name)).toEqual(['Shared Trip']);
	expect(forB.upcoming[0].isShared).toBe(true);
	expect(JSON.stringify(forB.upcoming)).not.toContain('SECRET');

	const forC = load({ locals: makeLocals(c) } as any) as any;
	expect(forC.upcoming.map((t: any) => t.name)).toEqual(['Group Trip']);
	expect(forC.upcoming[0].isShared).toBe(true);

	const forA = load({ locals: makeLocals(a) } as any) as any;
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
	const data = load({ locals: makeLocals(u) } as any) as any;
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

	const data = load({ locals: makeLocals(u) } as any) as any;
	expect(data.stats.upcoming).toBe(1);
	expect(data.stats.unread).toBe(1);
	expect(data.stats.expiring).toBe(1);
	expect(data.stats.watches).toBe(1);
});

test('dashboard agenda includes trips covering today and segments starting/ending today in user timezone', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

	const u = db
		.insert(users)
		.values({ email: 'agenda@x.c', passwordHash: 'x', displayName: 'U', timezone: 'America/New_York' })
		.returning()
		.get();

	// Trip covering today in NY (2026-07-15)
	const covering = db
		.insert(trips)
		.values({ ownerId: u.id, name: 'Summer Trip', destination: 'Boston', startDate: '2026-07-10', endDate: '2026-07-20' })
		.returning()
		.get();

	// Trip not covering today
	db.insert(trips)
		.values({ ownerId: u.id, name: 'Past Trip', startDate: '2026-07-01', endDate: '2026-07-14' })
		.run();

	// Segment starting today at 8:00 AM NY (12:00 UTC)
	db.insert(segments)
		.values({ tripId: covering.id, type: 'flight', title: 'Outbound', startAt: '2026-07-15T12:00:00Z', startTz: 'America/New_York' })
		.run();

	// Segment ending today at 6:00 PM NY (22:00 UTC)
	db.insert(segments)
		.values({
			tripId: covering.id,
			type: 'hotel',
			title: 'Checkout',
			startAt: '2026-07-14T15:00:00Z',
			startTz: 'America/New_York',
			endAt: '2026-07-15T22:00:00Z'
		})
		.run();

	// Segment starting tomorrow in NY
	db.insert(segments)
		.values({ tripId: covering.id, type: 'event', title: 'Tomorrow event', startAt: '2026-07-16T04:00:00Z', startTz: 'America/New_York' })
		.run();

	const data = load({ locals: makeLocals(u) } as any) as any;
	expect(data.agenda).toHaveLength(3);

	const kinds = data.agenda.map((a: any) => a.kind);
	expect(kinds).toEqual(['segment-start', 'segment-end', 'trip']);

	const outbound = data.agenda.find((a: any) => a.title === 'Outbound');
	expect(outbound.kind).toBe('segment-start');
	expect(outbound.time).toBe('8:00 AM');
	expect(outbound.type).toBe('flight');

	const checkout = data.agenda.find((a: any) => a.title === 'Checkout');
	expect(checkout.kind).toBe('segment-end');
	expect(checkout.time).toBe('6:00 PM');

	const tripItem = data.agenda.find((a: any) => a.kind === 'trip');
	expect(tripItem.name).toBe('Summer Trip');
	expect(tripItem.isShared).toBe(false);

	vi.useRealTimers();
});

test('dashboard agenda is empty when nothing happens today', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));

	const u = db.insert(users).values({ email: 'empty@x.c', passwordHash: 'x', displayName: 'U' }).returning().get();
	db.insert(trips).values({ ownerId: u.id, name: 'Future Trip', startDate: '2026-08-01', endDate: '2026-08-10' }).run();

	const data = load({ locals: makeLocals(u) } as any) as any;
	expect(data.agenda).toHaveLength(0);

	vi.useRealTimers();
});
