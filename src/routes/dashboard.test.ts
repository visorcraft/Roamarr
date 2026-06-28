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
import { kit } from '$lib/server/db';

import {
	makeUser,
	makeTrip,
	makeSegment,
	makeGroup,
	makeGroupMember,
	makeShare,
	makeNotification,
	makeTravelDocument,
	makeFareProvider,
	makeFareWatch
} from '../../tests/helpers';


import { load } from './+page.server';
import { users, trips, groups, groupMembers, tripShares, segments, travelDocuments, notifications, fareProviders, fareWatches } from '$lib/server/db/schema';
import { makeLocals } from '../../tests/eventHelpers';

test('dashboard includes upcoming trips shared with the user and labels them shared', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser(kit, { email: 'a@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'b@x.c', passwordHash: 'x', displayName: 'B' });
	const c = makeUser(kit, { email: 'c@x.c', passwordHash: 'x', displayName: 'C' });

	const future = '2026-07-01';
	const past = '2026-01-01';

	// Owned by A, shared directly with B
	const shared = makeTrip(kit, a.id, { name: 'Shared Trip', destinationCountryCode: 'FR', destinationCityName: 'Paris', destinationCityLat: 48.8566, destinationCityLng: 2.3522, startDate: future, notes: 'SECRET' });
	makeShare(kit, { tripId: shared.id, sharedWithUserId: b.id });

	// Owned by A, shared with group containing C
	const groupShared = makeTrip(kit, a.id, { name: 'Group Trip', destinationCountryCode: 'JP', destinationCityName: 'Tokyo', destinationCityLat: 35.6762, destinationCityLng: 139.6503, startDate: future });
	const g = makeGroup(kit, a.id, 'fam');
	makeGroupMember(kit, g.id, c.id);
	makeShare(kit, { tripId: groupShared.id, sharedWithGroupId: g.id });

	// Owned by A, not shared
	makeTrip(kit, a.id, { name: 'Private Trip', destinationCountryCode: 'DE', destinationCityName: 'Berlin', destinationCityLat: 52.52, destinationCityLng: 13.405, startDate: future });

	// Past shared trip should not appear in upcoming list
	const pastShared = makeTrip(kit, a.id, { name: 'Past Shared', destinationCountryCode: 'IT', destinationCityName: 'Rome', destinationCityLat: 41.9028, destinationCityLng: 12.4964, startDate: past });
	makeShare(kit, { tripId: pastShared.id, sharedWithUserId: b.id });

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
	const u = makeUser(kit, { email: 'lead@x.c', passwordHash: 'x', displayName: 'U', documentExpiryLeadDays: 30 });
	// Expires in 60 days, outside the 30-day lead window
	db.insert(travelDocuments).values({ userId: u.id, type: 'passport', expiresOn: '2026-08-24' }).run();
	const data = load({ locals: makeLocals(u) } as any) as any;
	expect(data.expiring).toHaveLength(0);
});

test('dashboard stats reflect unread notifications, expiring docs and fare watches', () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = makeUser(kit, { email: 'stats@x.c', passwordHash: 'x', displayName: 'U' });
	makeNotification(kit, u.id, { title: 'A', body: 'B' });
	makeTravelDocument(kit, u.id, { type: 'passport', expiresOn: '2026-06-25' });

	const fp = makeFareProvider(kit, u.id, { providerKey: 'stub', label: 'S' });
	const t = makeTrip(kit, u.id, { name: 'T', startDate: '2026-07-01' });
	makeFareWatch(kit, { tripId: t.id, providerId: fp.id });

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

	const u = makeUser(kit, { email: 'agenda@x.c', passwordHash: 'x', displayName: 'U', timezone: 'America/New_York' });

	// Trip covering today in NY (2026-07-15)
	const covering = makeTrip(kit, u.id, { name: 'Summer Trip', destinationCountryCode: 'US', destinationCityName: 'Boston', destinationCityLat: 42.3601, destinationCityLng: -71.0589, startDate: '2026-07-10', endDate: '2026-07-20' });

	// Trip not covering today
	makeTrip(kit, u.id, { name: 'Past Trip', startDate: '2026-07-01', endDate: '2026-07-14' });

	// Segment starting today at 8:00 AM NY (12:00 UTC)
	makeSegment(kit, covering.id, { type: 'flight', title: 'Outbound', startAt: '2026-07-15T12:00:00Z', startTz: 'America/New_York' });

	// Segment ending today at 6:00 PM NY (22:00 UTC)
	makeSegment(kit, covering.id, {
			type: 'hotel',
			title: 'Checkout',
			startAt: '2026-07-14T15:00:00Z',
			startTz: 'America/New_York',
			endAt: '2026-07-15T22:00:00Z'
		});

	// Segment starting tomorrow in NY
	makeSegment(kit, covering.id, { type: 'event', title: 'Tomorrow event', startAt: '2026-07-16T04:00:00Z', startTz: 'America/New_York' });

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

	const u = makeUser(kit, { email: 'empty@x.c', passwordHash: 'x', displayName: 'U' });
	makeTrip(kit, u.id, { name: 'Future Trip', startDate: '2026-08-01', endDate: '2026-08-10' });

	const data = load({ locals: makeLocals(u) } as any) as any;
	expect(data.agenda).toHaveLength(0);

	vi.useRealTimers();
});
