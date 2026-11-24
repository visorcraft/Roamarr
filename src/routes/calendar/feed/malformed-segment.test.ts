import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

const stub = vi.hoisted(() => ({ views: new Map<number, unknown>() }));
vi.mock('../../trips/shared', () => ({
	loadTripFor: (_userId: number, tripId: number) => stub.views.get(Number(tripId))
}));

import { GET } from './+server';
import { resetRateLimit } from '$lib/server/rateLimit';
import { makeUser, makeTrip } from '../../../../tests/helpers';

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

let trip1Id = 0;
let trip2Id = 0;

beforeEach(() => {
	resetRateLimit();
	const kit = kitDb();
	const user = makeUser(kit, { calendarToken: 'cal-test-token' });
	const trip1 = makeTrip(kit, user.id, { name: 'Trip One' });
	const trip2 = makeTrip(kit, user.id, { name: 'Trip Two' });
	trip1Id = trip1.id;
	trip2Id = trip2.id;

	stub.views.clear();
	stub.views.set(trip1.id, {
		owner: true,
		editor: true,
		trip: trip1,
		segments: [
			{ type: 'flight', title: 'Broken', startAt: 'not-a-date', endAt: null, location: null },
			{ type: 'hotel', title: 'Healthy', startAt: '2026-08-01T15:00:00.000Z', endAt: null, location: null }
		]
	});
	stub.views.set(trip2.id, {
		owner: true,
		editor: true,
		trip: trip2,
		segments: [
			{
				type: 'flight',
				title: 'Trip Two Flight',
				startAt: '2026-08-10T09:00:00.000Z',
				endAt: '2026-02-30T18:00:00Z',
				location: null
			}
		]
	});
});

test('GET returns a 200 calendar for a user whose segments have malformed times', () => {
	const res = GET(event('cal-test-token', '1.2.3.4')) as Response;
	expect(res.status).toBe(200);
	expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');

	return res.text().then((body) => {
		expect(body.startsWith('BEGIN:VCALENDAR')).toBe(true);
		expect(body).toContain('SUMMARY:Hotel: Healthy');
		expect(body).toContain(`UID:roamarr-trip-${trip1Id}-segment-2@roamarr`);
		expect(body).not.toContain('Broken');
		expect(body).not.toContain(`roamarr-trip-${trip1Id}-segment-1@roamarr`);
		expect(body).toContain('DTSTART:20260810T090000Z');

		const trip2Event = body.split('BEGIN:VEVENT').find((e) => e.includes('Trip Two Flight'));
		expect(trip2Event).toBeDefined();
		expect(trip2Event).not.toContain('DTEND');
	});
});
