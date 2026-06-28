import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { users, trips, segments, groups, groupMembers, tripShares } from '$lib/server/db/mongrelSchema';
import { resetRateLimit } from '$lib/server/rateLimit';

function event(token: string, ip: string) {
	return {
		params: {},
		url: new URL(`http://localhost/calendar/feed?token=${encodeURIComponent(token)}`),
		getClientAddress: () => ip
	} as any;
}

test('GET returns an ICS calendar for a valid user token', () => {
	resetRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db
		.insert(users)
		.values({ email: 'feed@x.c', passwordHash: 'x', displayName: 'U', calendarToken: 'user-cal-1' })
		.returning()
		.get();
	const t = db
		.insert(trips)
		.values({ ownerId: u.id, name: 'Trip A', startDate: '2026-07-01', endDate: '2026-07-05' })
		.returning()
		.get();
	db.insert(segments)
		.values({
			tripId: t.id,
			type: 'flight',
			title: 'UA123',
			startAt: '2026-07-01T15:00:00Z',
			startTz: 'UTC',
			endAt: '2026-07-01T18:00:00Z',
			location: 'JFK'
		})
		.run();

	const res = GET(event('user-cal-1', '1.2.3.4')) as Response;
	expect(res.status).toBe(200);
	expect(res.headers.get('Content-Type')).toContain('text/calendar');
	expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="roamarr-calendar.ics"');
});

test('GET aggregates owned and shared trips', () => {
	resetRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db
		.insert(users)
		.values({ email: 'owner@x.c', passwordHash: 'x', displayName: 'Owner' })
		.returning()
		.get();
	const viewer = db
		.insert(users)
		.values({
			email: 'viewer@x.c',
			passwordHash: 'x',
			displayName: 'Viewer',
			calendarToken: 'user-cal-2'
		})
		.returning()
		.get();

	const ownedByViewer = db
		.insert(trips)
		.values({ ownerId: viewer.id, name: 'My Trip', startDate: '2026-08-01' })
		.returning()
		.get();
	const shared = db
		.insert(trips)
		.values({ ownerId: owner.id, name: 'Shared Trip', startDate: '2026-08-10' })
		.returning()
		.get();
	db.insert(tripShares).values({ tripId: shared.id, sharedWithUserId: viewer.id }).run();

	db.insert(segments)
		.values({
			tripId: ownedByViewer.id,
			type: 'hotel',
			title: 'Check-in',
			startAt: '2026-08-01T20:00:00Z',
			startTz: 'UTC'
		})
		.run();
	db.insert(segments)
		.values({
			tripId: shared.id,
			type: 'flight',
			title: 'DL456',
			startAt: '2026-08-10T14:00:00Z',
			startTz: 'UTC',
			endAt: '2026-08-10T17:00:00Z'
		})
		.run();

	const res = GET(event('user-cal-2', '1.2.3.4')) as Response;
	expect(res.status).toBe(200);
});

test('GET includes group-shared trips', () => {
	resetRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const owner = db
		.insert(users)
		.values({ email: 'gowner@x.c', passwordHash: 'x', displayName: 'GOwner' })
		.returning()
		.get();
	const member = db
		.insert(users)
		.values({
			email: 'member@x.c',
			passwordHash: 'x',
			displayName: 'Member',
			calendarToken: 'user-cal-3'
		})
		.returning()
		.get();

	const g = db.insert(groups).values({ ownerId: owner.id, name: 'fam' }).returning().get();
	db.insert(groupMembers).values({ groupId: g.id, userId: member.id }).run();

	const shared = db
		.insert(trips)
		.values({ ownerId: owner.id, name: 'Group Trip', startDate: '2026-09-01' })
		.returning()
		.get();
	db.insert(tripShares).values({ tripId: shared.id, sharedWithGroupId: g.id }).run();

	const res = GET(event('user-cal-3', '1.2.3.4')) as Response;
	expect(res.status).toBe(200);
});

test('GET returns 404 for missing token', () => {
	resetRateLimit();
	try {
		GET(event('', '1.2.3.4'));
		expect.fail('expected 404');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('GET returns 404 for expired token', () => {
	resetRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	db.insert(users)
		.values({
			email: 'exp@x.c',
			passwordHash: 'x',
			displayName: 'E',
			calendarToken: 'user-cal-exp',
			calendarTokenExpiresAt: '2020-01-01T00:00:00Z'
		})
		.run();

	try {
		GET(event('user-cal-exp', '1.2.3.4'));
		expect.fail('expected 404');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('GET is rate limited after many requests from the same IP', () => {
	resetRateLimit();
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	db.insert(users)
		.values({
			email: 'rl@x.c',
			passwordHash: 'x',
			displayName: 'RL',
			calendarToken: 'user-cal-rl'
		})
		.run();

	for (let i = 0; i < 30; i++) {
		GET(event('user-cal-rl', '1.2.3.4'));
	}
	const res = GET(event('user-cal-rl', '1.2.3.4')) as Response;
	expect(res.status).toBe(429);
	expect(res.headers.get('Retry-After')).toBeTruthy();
});
