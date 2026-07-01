import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { users, trips, segments, groups, groupMembers, tripShares } from '$lib/server/db/mongrelSchema';
import { resetRateLimit } from '$lib/server/rateLimit';

function kitDb(): import('@visorcraft/mongreldb-kit').KitDatabase {
	return (ctx as { kit: import('@visorcraft/mongreldb-kit').KitDatabase }).kit;
}

function event(token: string, ip: string) {
	return {
		params: {},
		url: new URL(`http://localhost/calendar/feed?token=${encodeURIComponent(token)}`),
		getClientAddress: () => ip
	} as any;
}

test('GET returns an ICS calendar for a valid user token', () => {
	resetRateLimit();
	const kit = kitDb();
	const u = kit
		.insertInto(users)
		.values({ email: 'feed@x.c', password_hash: 'x', display_name: 'U', calendar_token: 'user-cal-1' })
		.executeSync();
	const t = kit
		.insertInto(trips)
		.values({ owner_id: u.id, name: 'Trip A', start_date: '2026-07-01', end_date: '2026-07-05' })
		.executeSync();
	kit
		.insertInto(segments)
		.values({
			trip_id: t.id,
			type: 'flight',
			title: 'UA123',
			start_at: '2026-07-01T15:00:00Z',
			end_at: '2026-07-01T18:00:00Z',
			location: 'JFK'
		})
		.executeSync();

	const res = GET(event('user-cal-1', '1.2.3.4')) as Response;
	expect(res.status).toBe(200);
	expect(res.headers.get('Content-Type')).toContain('text/calendar');
	expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="roamarr-calendar.ics"');
});

test('GET aggregates owned and shared trips', () => {
	resetRateLimit();
	const kit = kitDb();
	const owner = kit
		.insertInto(users)
		.values({ email: 'owner@x.c', password_hash: 'x', display_name: 'Owner' })
		.executeSync();
	const viewer = kit
		.insertInto(users)
		.values({
			email: 'viewer@x.c',
			password_hash: 'x',
			display_name: 'Viewer',
			calendar_token: 'user-cal-2'
		})
		.executeSync();

	const ownedByViewer = kit
		.insertInto(trips)
		.values({ owner_id: viewer.id, name: 'My Trip', start_date: '2026-08-01' })
		.executeSync();
	const shared = kit
		.insertInto(trips)
		.values({ owner_id: owner.id, name: 'Shared Trip', start_date: '2026-08-10' })
		.executeSync();
	kit.insertInto(tripShares).values({ trip_id: shared.id, shared_with_user_id: viewer.id }).executeSync();

	kit
		.insertInto(segments)
		.values({
			trip_id: ownedByViewer.id,
			type: 'hotel',
			title: 'Check-in',
			start_at: '2026-08-01T20:00:00Z'
		})
		.executeSync();
	kit
		.insertInto(segments)
		.values({
			trip_id: shared.id,
			type: 'flight',
			title: 'DL456',
			start_at: '2026-08-10T14:00:00Z',
			end_at: '2026-08-10T17:00:00Z'
		})
		.executeSync();

	const res = GET(event('user-cal-2', '1.2.3.4')) as Response;
	expect(res.status).toBe(200);
});

test('GET includes group-shared trips', () => {
	resetRateLimit();
	const kit = kitDb();
	const owner = kit
		.insertInto(users)
		.values({ email: 'gowner@x.c', password_hash: 'x', display_name: 'GOwner' })
		.executeSync();
	const member = kit
		.insertInto(users)
		.values({
			email: 'member@x.c',
			password_hash: 'x',
			display_name: 'Member',
			calendar_token: 'user-cal-3'
		})
		.executeSync();

	const g = kit.insertInto(groups).values({ owner_id: owner.id, name: 'fam' }).executeSync();
	kit.insertInto(groupMembers).values({ group_id: g.id, user_id: member.id }).executeSync();

	const shared = kit
		.insertInto(trips)
		.values({ owner_id: owner.id, name: 'Group Trip', start_date: '2026-09-01' })
		.executeSync();
	kit.insertInto(tripShares).values({ trip_id: shared.id, shared_with_group_id: g.id }).executeSync();

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
	const kit = kitDb();
	kit
		.insertInto(users)
		.values({
			email: 'exp@x.c',
			password_hash: 'x',
			display_name: 'E',
			calendar_token: 'user-cal-exp',
			calendar_token_expires_at: '2020-01-01T00:00:00Z'
		})
		.executeSync();

	try {
		GET(event('user-cal-exp', '1.2.3.4'));
		expect.fail('expected 404');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('GET is rate limited after many requests from the same IP', () => {
	resetRateLimit();
	const kit = kitDb();
	kit
		.insertInto(users)
		.values({
			email: 'rl@x.c',
			password_hash: 'x',
			display_name: 'RL',
			calendar_token: 'user-cal-rl'
		})
		.executeSync();

	for (let i = 0; i < 30; i++) {
		GET(event('user-cal-rl', '1.2.3.4'));
	}
	const res = GET(event('user-cal-rl', '1.2.3.4')) as Response;
	expect(res.status).toBe(429);
	expect(res.headers.get('Retry-After')).toBeTruthy();
});
