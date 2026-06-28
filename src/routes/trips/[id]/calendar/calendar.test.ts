import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from '$lib/server/db';

import { makeUser, makeSegment, makeShare } from '../../../../../tests/helpers';


import { GET } from './+server';
import { createTrip } from '../../shared';
import { users, segments, tripShares } from '$lib/server/db/schema';

function event(locals: App.Locals, params: { id: string }) {
	return { locals, params, url: new URL(`http://localhost/trips/${params.id}/calendar`), request: new Request('http://localhost') } as any;
}

test('owner receives a text/calendar download', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser(kit, { email: 'cal-owner@x.c', passwordHash: 'x', displayName: 'A' });
	const t = createTrip(a.id, { name: 'Owner Trip', destinationCountryCode: 'FR', destinationCityName: 'Paris', destinationCityLat: 48.8566, destinationCityLng: 2.3522, startDate: '2026-07-01' });
	makeSegment(kit, t.id, {
			type: 'flight',
			title: 'AF1',
			startAt: '2026-07-01T10:00:00Z',
			startTz: 'UTC',
			endAt: '2026-07-01T13:00:00Z',
			location: 'CDG',
			confirmationNumber: 'OWNER-CONF'
		});

	const res = await GET(event({ user: a }, { id: String(t.id) }));
	expect(res.status).toBe(200);
	expect(res.headers.get('content-type')).toContain('text/calendar');
	expect(res.headers.get('content-disposition')).toContain(`roamarr-trip-${t.id}.ics`);
	const body = await res.text();
	expect(body).toContain('BEGIN:VCALENDAR');
	expect(body).toContain('SUMMARY:Flight: AF1');
	expect(body).toContain('DTSTART:20260701T100000Z');
	expect(body).toContain('DTEND:20260701T130000Z');
	expect(body).not.toContain('OWNER-CONF');
});

test('shared viewer receives a calendar without private fields', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser(kit, { email: 'cal-shared-owner@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'cal-shared@x.c', passwordHash: 'x', displayName: 'B' });
	const t = createTrip(a.id, {
		name: 'Shared Trip',
		destinationCountryCode: 'DE',
		destinationCityName: 'Berlin',
		destinationCityLat: 52.52,
		destinationCityLng: 13.405,
		startDate: '2026-08-01',
		notes: 'SECRET NOTES'
	});
	makeSegment(kit, t.id, {
			type: 'hotel',
			title: 'Hotel',
			startAt: '2026-08-01T16:00:00Z',
			startTz: 'UTC',
			location: 'Mitte',
			confirmationNumber: 'CONF123'
		});
	makeShare(kit, { tripId: t.id, sharedWithUserId: b.id });

	const res = await GET(event({ user: b }, { id: String(t.id) }));
	expect(res.status).toBe(200);
	const body = await res.text();
	expect(body).toContain('SUMMARY:Hotel: Hotel');
	expect(body).toContain('LOCATION:Mitte');
	expect(body).not.toContain('SECRET NOTES');
	expect(body).not.toContain('CONF123');
});

test('unshared user gets 404', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const a = makeUser(kit, { email: 'cal-unshared-owner@x.c', passwordHash: 'x', displayName: 'A' });
	const b = makeUser(kit, { email: 'cal-unshared@x.c', passwordHash: 'x', displayName: 'B' });
	const t = createTrip(a.id, { name: 'Private Trip' });

	try {
		await GET(event({ user: b }, { id: String(t.id) }));
		expect.fail('expected error');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('anonymous user gets 401', async () => {
	try {
		await GET(event({ user: null }, { id: '1' }));
		expect.fail('expected error');
	} catch (e: any) {
		expect(e.status).toBe(401);
	}
});
